'use strict'

const { randomBytes } = require('node:crypto')
const { evaluateCage } = require('./fleet-runtime.cjs')
const { FleetArtifactUploader } = require('./fleet-artifact-uploader.cjs')

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_RENEW_INTERVAL_MS = 20_000
const DEFAULT_LEASE_TTL_MS = 90_000
const MAX_RETRY_DELAY_MS = 5_000

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} must be a function.`)
  }
  return value
}

function boundedInterval(value, fallback, minimum, maximum, name) {
  const candidate = value == null ? fallback : Number(value)
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new RangeError(`${name} is outside its allowed range.`)
  }
  return candidate
}

function randomHex(bytes = 16) {
  return randomBytes(bytes).toString('hex')
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

function retryableError(error) {
  const status = Number(error?.status)
  if (Number.isFinite(status)) {
    if (status > 0) return status === 408 || status === 429 || status >= 500
    return (
      error?.retryable === true ||
      error?.code === 'offline' ||
      error?.code === 'timeout'
    )
  }
  return error?.code !== 'invalid_argument' &&
    error?.code !== 'permission_denied' &&
    error?.code !== 'failed_precondition' &&
    error?.code !== 'conflict'
}

function authorizationLost(error, action) {
  if (Number(error?.status) === 401 || error?.code === 'unauthenticated') {
    return true
  }
  return (
    Number(error?.status) === 403 &&
    error?.code === 'permission_denied' &&
    ['device.status', 'heartbeat', 'job.poll'].includes(action)
  )
}

function leaseAuthorityLost(error) {
  return (
    Number(error?.status) === 403 ||
    (Number(error?.status) === 409 &&
      ['conflict', 'failed_precondition'].includes(error?.code))
  )
}

function coordinatorTrustLost(error) {
  return error?.code === 'invalid_response_signature'
}

function publicFailure(error) {
  const code = typeof error?.code === 'string' &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(error.code)
    ? error.code
    : 'adapter_failed'
  return {
    code,
    message: 'The worker adapter did not complete this job.',
    retryable: error?.retryable === true,
  }
}

function cancellationReason(signal) {
  const code = signal?.reason?.code
  return code === 'cancellation-requested' || code === 'deadline-reached'
    ? code
    : null
}

function processTerminationUnconfirmed(error) {
  return error?.result?.terminationConfirmed === false
}

function normalizedResult(value) {
  if (value == null) return { summary: 'Job completed.' }
  if (typeof value === 'string') return { summary: value.slice(0, 4_000) }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { summary: 'Job completed.', value }
  }
  return value
}

class FleetNodeSupervisor {
  constructor({
    deviceId,
    postAction,
    adapters = {},
    collectHeartbeat,
    softwareVersion,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    renewIntervalMs = DEFAULT_RENEW_INTERVAL_MS,
    leaseTtlMs = DEFAULT_LEASE_TTL_MS,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timers = globalThis,
    logger = console,
    randomHexImpl = randomHex,
    randomTokenImpl = randomToken,
    artifactUploader,
    onQuarantine = null,
    onExecutionStart = null,
    onExecutionSettled = null,
    onLeaseAuthorityStart = null,
    onLeaseAuthorityRenewed = null,
    onLeaseAuthoritySettled = null,
  }) {
    if (typeof deviceId !== 'string' || !/^dev_[a-f0-9]{32}$/.test(deviceId)) {
      throw new TypeError('deviceId is invalid.')
    }
    if (!adapters || typeof adapters !== 'object' || Array.isArray(adapters)) {
      throw new TypeError('adapters must be an object.')
    }
    if (typeof softwareVersion !== 'string' || softwareVersion.trim().length === 0) {
      throw new TypeError('softwareVersion is required.')
    }
    this.deviceId = deviceId
    this.postAction = requireFunction(postAction, 'postAction')
    this.collectHeartbeat = requireFunction(collectHeartbeat, 'collectHeartbeat')
    this.adapters = Object.freeze({ ...adapters })
    this.softwareVersion = softwareVersion.trim().slice(0, 64)
    this.pollIntervalMs = boundedInterval(
      pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      250,
      5 * 60_000,
      'pollIntervalMs'
    )
    this.heartbeatIntervalMs = boundedInterval(
      heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      5_000,
      10 * 60_000,
      'heartbeatIntervalMs'
    )
    this.renewIntervalMs = boundedInterval(
      renewIntervalMs,
      DEFAULT_RENEW_INTERVAL_MS,
      1_000,
      60_000,
      'renewIntervalMs'
    )
    this.leaseTtlMs = boundedInterval(
      leaseTtlMs,
      DEFAULT_LEASE_TTL_MS,
      15_000,
      5 * 60_000,
      'leaseTtlMs'
    )
    if (this.renewIntervalMs * 2 >= this.leaseTtlMs) {
      throw new RangeError('renewIntervalMs must leave at least two renewal windows.')
    }
    this.now = requireFunction(now, 'now')
    this.sleep = requireFunction(sleep, 'sleep')
    this.setTimeout = requireFunction(timers?.setTimeout?.bind(timers), 'timers.setTimeout')
    this.clearTimeout = requireFunction(
      timers?.clearTimeout?.bind(timers),
      'timers.clearTimeout'
    )
    this.logger = logger
    this.randomHex = requireFunction(randomHexImpl, 'randomHexImpl')
    this.randomToken = requireFunction(randomTokenImpl, 'randomTokenImpl')
    this.artifactUploader = artifactUploader || new FleetArtifactUploader()
    this.onQuarantine =
      onQuarantine == null
        ? null
        : requireFunction(onQuarantine, 'onQuarantine')
    this.onExecutionStart =
      onExecutionStart == null
        ? null
        : requireFunction(onExecutionStart, 'onExecutionStart')
    this.onExecutionSettled =
      onExecutionSettled == null
        ? null
        : requireFunction(onExecutionSettled, 'onExecutionSettled')
    this.onLeaseAuthorityStart =
      onLeaseAuthorityStart == null
        ? null
        : requireFunction(onLeaseAuthorityStart, 'onLeaseAuthorityStart')
    this.onLeaseAuthorityRenewed =
      onLeaseAuthorityRenewed == null
        ? null
        : requireFunction(onLeaseAuthorityRenewed, 'onLeaseAuthorityRenewed')
    this.onLeaseAuthoritySettled =
      onLeaseAuthoritySettled == null
        ? null
        : requireFunction(onLeaseAuthoritySettled, 'onLeaseAuthoritySettled')
    if (
      typeof this.artifactUploader.describeFile !== 'function' ||
      typeof this.artifactUploader.uploadFile !== 'function'
    ) {
      throw new TypeError('artifactUploader is invalid.')
    }
    this.running = false
    this.pollTimer = null
    this.heartbeatTimer = null
    this.pollOperation = null
    this.heartbeatOperation = null
    this.pollCursorJobId = null
    this.active = null
    this.pausedReason = null
    this.lifecycleController = new AbortController()
  }

  status() {
    return {
      running: this.running,
      activeJobId: this.active?.jobId || null,
      activeAttempt: this.active?.attempt || null,
      pausedReason: this.pausedReason,
    }
  }

  pauseForTrustLoss(reason) {
    this.pausedReason = reason
    this.running = false
    if (this.pollTimer) this.clearTimeout(this.pollTimer)
    if (this.heartbeatTimer) this.clearTimeout(this.heartbeatTimer)
    this.pollTimer = null
    this.heartbeatTimer = null
    if (!this.lifecycleController.signal.aborted) {
      this.lifecycleController.abort({ code: reason })
    }
    if (this.active && !this.active.controller.signal.aborted) {
      this.active.controller.abort({ code: 'authorization-lost' })
    }
  }

  async send(action, payload, { attempts = 3, signal } = {}) {
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (signal?.aborted) throw signal.reason
      try {
        return await this.postAction(
          action,
          payload,
          signal ? { signal } : undefined
        )
      } catch (error) {
        lastError = error
        if (authorizationLost(error, action)) {
          this.pauseForTrustLoss('authorization-lost')
          throw error
        }
        if (coordinatorTrustLost(error)) {
          this.pauseForTrustLoss('coordinator-trust-lost')
          throw error
        }
        if (attempt >= attempts || !retryableError(error)) throw error
        if (signal?.aborted) throw signal.reason
        await this.sleep(Math.min(250 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS))
        if (signal?.aborted) throw signal.reason
      }
    }
    throw lastError
  }

  async heartbeatOnce(signal = this.lifecycleController.signal) {
    const telemetry = await this.collectHeartbeat()
    if (!telemetry || typeof telemetry !== 'object' || Array.isArray(telemetry)) {
      throw new TypeError('collectHeartbeat must return an object.')
    }
    return this.send(
      'heartbeat',
      {
        ...telemetry,
        activeJobs: this.active ? 1 : 0,
        connection: 'relay',
        protocolMinimum: 1,
        protocolMaximum: 1,
        softwareVersion: this.softwareVersion,
      },
      { signal }
    )
  }

  async runOnce(signal = this.lifecycleController.signal) {
    if (signal?.aborted) throw signal.reason
    if (this.active) {
      return { status: 'busy', jobId: this.active.jobId }
    }
    const poll = await this.send(
      'job.poll',
      {
        limit: 20,
        ...(this.pollCursorJobId
          ? { cursorJobId: this.pollCursorJobId }
          : {}),
      },
      { signal }
    )
    if (signal?.aborted) throw signal.reason
    if (!poll?.assignment) {
      if (
        poll?.cursorJobId != null &&
        !/^job_[a-f0-9]{32}$/.test(poll.cursorJobId)
      ) {
        throw new Error('The fleet poll cursor is invalid.')
      }
      this.pollCursorJobId = poll?.cursorJobId || null
      const retryAfterMs = boundedInterval(
        poll?.retryAfterMs,
        this.pollIntervalMs,
        250,
        5 * 60_000,
        'retryAfterMs'
      )
      return { status: 'idle', retryAfterMs }
    }
    this.pollCursorJobId = null
    return this.executeAssignment(poll.assignment, signal)
  }

  async executeAssignment(
    assignment,
    lifecycleSignal = this.lifecycleController.signal
  ) {
    if (lifecycleSignal?.aborted) throw lifecycleSignal.reason
    if (
      !assignment ||
      typeof assignment.jobId !== 'string' ||
      typeof assignment.grantId !== 'string'
    ) {
      throw new TypeError('The fleet assignment is invalid.')
    }
    const claimPayload = {
      jobId: assignment.jobId,
      grantId: assignment.grantId,
      leaseId: `lease_${this.randomHex(16)}`,
      leaseNonce: this.randomToken(32),
      ttlMs: this.leaseTtlMs,
    }
    const claim = await this.send('job.claim', claimPayload, {
      signal: lifecycleSignal,
    })
    if (lifecycleSignal?.aborted) throw lifecycleSignal.reason
    const job = claim?.job
    const lease = claim?.lease
    if (
      !job ||
      !lease ||
      job.id !== assignment.jobId ||
      lease.id !== claimPayload.leaseId ||
      lease.nonce !== claimPayload.leaseNonce ||
      lease.jobId !== assignment.jobId ||
      lease.deviceId !== this.deviceId ||
      !Number.isFinite(Date.parse(lease.expiresAt)) ||
      Date.parse(lease.expiresAt) <= Number(this.now()) ||
      !Number.isFinite(Date.parse(job.deadlineAt)) ||
      Date.parse(job.deadlineAt) < Date.parse(lease.expiresAt)
    ) {
      throw new Error('The claim response did not match the signed request.')
    }
    const controller = new AbortController()
    const onLifecycleAbort = () =>
      controller.abort(lifecycleSignal?.reason || { code: 'local-stop' })
    if (lifecycleSignal?.aborted) onLifecycleAbort()
    else {
      lifecycleSignal?.addEventListener?.('abort', onLifecycleAbort, {
        once: true,
      })
    }
    const active = {
      jobId: job.id,
      attempt: lease.attempt,
      lease,
      controller,
      eventSequence: Number(job.eventSequence || 0),
      renewTimer: null,
      expiryTimer: null,
      renewing: false,
      renewOperation: null,
      settling: false,
    }
    this.active = active

    const credential = {
      jobId: job.id,
      leaseId: lease.id,
      nonce: lease.nonce,
    }
    const transition = (
      state,
      { allowAfterAbort = false, retry = null } = {}
    ) =>
      this.send(
        'job.transition',
        {
          ...credential,
          state,
          transitionId: `op_${this.randomHex(16)}`,
          ...(retry ? { retry } : {}),
        },
        allowAfterAbort ? {} : { signal: controller.signal }
      )
    const emit = async (type, payload = {}) => {
      const sequence = active.eventSequence + 1
      const result = await this.send(
        'job.event',
        {
          ...credential,
          event: { sequence, type, payload },
        },
        { signal: controller.signal }
      )
      if (Number(result?.sequence) !== sequence) {
        throw new Error('The event acknowledgement is invalid.')
      }
      active.eventSequence = sequence
      return result
    }
    const publishArtifact = async ({ filePath, kind, mediaType }) => {
      if (controller.signal.aborted) throw controller.signal.reason
      const artifactId = `artifact_${this.randomHex(16)}`
      const descriptor = await this.artifactUploader.describeFile({
        filePath,
        artifactId,
        kind,
        mediaType,
        signal: controller.signal,
      })
      try {
        if (controller.signal.aborted) throw controller.signal.reason
        const reservation = await this.send(
          'artifact.reserve',
          {
            ...credential,
            artifact: {
              id: descriptor.id,
              kind: descriptor.kind,
              contentHash: descriptor.contentHash,
              contentMd5: descriptor.contentMd5,
              sizeBytes: descriptor.sizeBytes,
              mediaType: descriptor.mediaType,
            },
          },
          { signal: controller.signal }
        )
        if (
          reservation?.artifact?.id !== descriptor.id ||
          reservation.artifact.contentHash !== descriptor.contentHash ||
          Number(reservation.artifact.sizeBytes) !== descriptor.sizeBytes ||
          reservation.artifact.state !== 'uploading' ||
          !reservation.upload
        ) {
          const error = new Error(
            'Artifact reservation acknowledgement is invalid.'
          )
          error.code = 'invalid_response'
          throw error
        }
        let ambiguousUploadError = null
        try {
          await this.artifactUploader.uploadFile({
            descriptor,
            grant: reservation.upload,
            signal: controller.signal,
          })
        } catch (error) {
          if (error?.code === 'artifact_upload_offline') {
            ambiguousUploadError = error
          } else if (error?.code !== 'artifact_already_exists') {
            throw error
          }
        }
        if (controller.signal.aborted) throw controller.signal.reason
        let committed
        try {
          committed = await this.send(
            'artifact.commit',
            {
              ...credential,
              artifactId: descriptor.id,
            },
            { signal: controller.signal }
          )
        } catch (error) {
          if (
            ambiguousUploadError &&
            error?.code === 'failed_precondition'
          ) {
            throw ambiguousUploadError
          }
          throw error
        }
        if (
          committed?.id !== descriptor.id ||
          committed.contentHash !== descriptor.contentHash ||
          Number(committed.sizeBytes) !== descriptor.sizeBytes ||
          committed.state !== 'ready'
        ) {
          const error = new Error('Artifact commit acknowledgement is invalid.')
          error.code = 'invalid_response'
          throw error
        }
        await emit('artifact', {
          artifactId: committed.id,
          kind: committed.kind,
          contentHash: committed.contentHash,
          sizeBytes: committed.sizeBytes,
          mediaType: committed.mediaType,
        })
        return committed
      } finally {
        await this.artifactUploader.releaseFile?.({ descriptor })
      }
    }
    let adapter = null
    let adapterContext = null
    let cleanupAllowed = true
    let executionEntered = false
    let executionMarkerWritten = false
    let executionMarkerFailed = false
    let authorityFenceWritten = false
    let authorityFenceFailed = false
    const scheduleLeaseExpiry = (expiresAt) => {
      if (active.expiryTimer) this.clearTimeout(active.expiryTimer)
      const remainingMs = Date.parse(expiresAt) - Number(this.now())
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        controller.abort({ code: 'lease-expired' })
        return
      }
      active.expiryTimer = this.setTimeout(() => {
        controller.abort({ code: 'lease-expired' })
      }, remainingMs)
    }
    scheduleLeaseExpiry(lease.expiresAt)
    const renew = ({ allowSettling = false } = {}) => {
      if (controller.signal.aborted) return Promise.resolve(null)
      if (active.settling && !allowSettling) return Promise.resolve(null)
      if (active.renewOperation) return active.renewOperation
      active.renewing = true
      const operation = (async () => {
        const result = await this.send(
          'lease.renew',
          {
            leaseId: lease.id,
            nonce: lease.nonce,
            ttlMs: this.leaseTtlMs,
          },
          { signal: controller.signal }
        )
        if (result?.leaseId !== lease.id) {
          const error = new Error('The lease renewal acknowledgement is invalid.')
          error.code = 'invalid_response'
          throw error
        }
        if (result?.cancellationRequested) {
          controller.abort({ code: 'cancellation-requested' })
        } else if (
          result?.deadlineAt &&
          new Date(result.deadlineAt).getTime() <= Number(this.now())
        ) {
          controller.abort({ code: 'deadline-reached' })
        } else if (
          !Number.isFinite(Date.parse(result?.expiresAt)) ||
          Date.parse(result.expiresAt) <= Number(this.now())
        ) {
          const error = new Error('The renewed lease expiry is invalid.')
          error.code = 'invalid_response'
          throw error
        } else {
          if (this.onLeaseAuthorityRenewed) {
            try {
              await this.onLeaseAuthorityRenewed({
                jobId: job.id,
                leaseId: lease.id,
                expiresAt: result.expiresAt,
                deadlineAt: result.deadlineAt || job.deadlineAt,
              })
            } catch (error) {
              authorityFenceFailed = true
              if (error?.code === 'worker_authority_fence_unavailable') {
                throw error
              }
              const wrapped = new Error(
                'The worker could not renew its lease-authority fence.'
              )
              wrapped.code = 'worker_authority_fence_unavailable'
              wrapped.cause = error
              throw wrapped
            }
          }
          scheduleLeaseExpiry(result.expiresAt)
        }
        return result
      })()
      active.renewOperation = operation
      void operation.finally(() => {
        if (active.renewOperation === operation) {
          active.renewOperation = null
          active.renewing = false
        }
      }).catch(() => {})
      return operation
    }
    const scheduleRenewal = () => {
      active.renewTimer = this.setTimeout(async () => {
        try {
          await renew()
        } catch (error) {
          this.logger?.warn?.('Fleet lease renewal failed.', {
            jobId: job.id,
            code: error?.code || 'unknown',
          })
          if (
            error?.code === 'worker_authority_fence_unavailable' &&
            !controller.signal.aborted
          ) {
            controller.abort({ code: 'worker-authority-fence-unavailable' })
          } else if (
            leaseAuthorityLost(error) &&
            !controller.signal.aborted
          ) {
            controller.abort({ code: 'lease-authority-lost' })
          } else if (!retryableError(error) && !controller.signal.aborted) {
            controller.abort({ code: 'lease-lost' })
          }
        }
        if (!controller.signal.aborted && !active.settling) scheduleRenewal()
      }, this.renewIntervalMs)
    }
    scheduleRenewal()

    try {
      if (this.onExecutionStart) {
        try {
          await this.onExecutionStart({
            reason: 'job-active',
            jobId: job.id,
            attempt: Number(job.attempt || lease.attempt || 0),
          })
          executionMarkerWritten = true
        } catch {
          executionMarkerFailed = true
          const error = new Error(
            'The worker could not persist its active-job safety marker.'
          )
          error.code = 'worker_marker_unavailable'
          throw error
        }
      }
      if (this.onLeaseAuthorityStart) {
        try {
          await this.onLeaseAuthorityStart({
            jobId: job.id,
            leaseId: lease.id,
            expiresAt: lease.expiresAt,
            deadlineAt: job.deadlineAt,
          })
          authorityFenceWritten = true
        } catch {
          authorityFenceFailed = true
          const error = new Error(
            'The worker could not persist its lease-authority fence.'
          )
          error.code = 'worker_authority_fence_unavailable'
          throw error
        }
      }
      adapter = this.adapters[job.type]
      if (!adapter || typeof adapter.run !== 'function') {
        const error = new Error('No worker adapter is installed for this job type.')
        error.code = 'unsupported_job_type'
        throw error
      }
      await emit('accepted', {
        workerDeviceId: this.deviceId,
        adapter: job.type,
      })
      await transition('preparing')
      await emit('preparation', { status: 'started' })
      adapterContext = Object.freeze({
        job,
        lease: {
          id: lease.id,
          attempt: lease.attempt,
          expiresAt: lease.expiresAt,
        },
        signal: controller.signal,
        emit,
        publishArtifact,
        evaluateCage,
        now: this.now,
      })
      if (typeof adapter.prepare === 'function') {
        await adapter.prepare(adapterContext)
      }
      await renew()
      if (controller.signal.aborted) throw controller.signal.reason
      await transition('running')
      executionEntered = true
      await emit('process-start', { status: 'started' })
      const result = await adapter.run(adapterContext)
      await renew()
      if (controller.signal.aborted) throw controller.signal.reason
      await emit('result', normalizedResult(result))
      active.settling = true
      if (active.renewTimer) this.clearTimeout(active.renewTimer)
      active.renewTimer = null
      await renew({ allowSettling: true })
      if (controller.signal.aborted) throw controller.signal.reason
      const completed = await transition('succeeded')
      return { status: 'succeeded', job: completed }
    } catch (error) {
      if (processTerminationUnconfirmed(error)) {
        cleanupAllowed = false
        this.pausedReason = 'process-termination-unconfirmed'
        this.running = false
        if (this.pollTimer) this.clearTimeout(this.pollTimer)
        if (this.heartbeatTimer) this.clearTimeout(this.heartbeatTimer)
        this.pollTimer = null
        this.heartbeatTimer = null
        if (!this.lifecycleController.signal.aborted) {
          this.lifecycleController.abort({
            code: 'process-termination-unconfirmed',
          })
        }
        try {
          await this.onQuarantine?.({
            reason: 'process-termination-unconfirmed',
            jobId: job.id,
            attempt: Number(job.attempt || lease.attempt || 0),
          })
        } catch (quarantineError) {
          this.logger?.error?.('Fleet worker quarantine was not persisted.', {
            jobId: job.id,
            code: quarantineError?.code || 'unknown',
          })
        }
        return {
          status: 'abandoned',
          jobId: job.id,
          reason: 'process-termination-unconfirmed',
        }
      }
      const cancellation = cancellationReason(controller.signal)
      if (cancellation) {
        try {
          const cancelled = await transition('cancelled', {
            allowAfterAbort: true,
          })
          return { status: 'cancelled', job: cancelled }
        } catch (terminalError) {
          this.logger?.warn?.('Fleet cancellation acknowledgement failed.', {
            jobId: job.id,
            code: terminalError?.code || 'unknown',
          })
          return { status: 'abandoned', jobId: job.id }
        }
      }
      if (controller.signal.aborted) {
        return {
          status: 'abandoned',
          jobId: job.id,
          reason: controller.signal.reason?.code || 'lease-lost',
        }
      }
      try {
        await emit('failure', publicFailure(error))
      } catch (eventError) {
        this.logger?.warn?.('Fleet failure event was not accepted.', {
          jobId: job.id,
          code: eventError?.code || 'unknown',
        })
      }
      if (
        error?.retryable === true &&
        (!executionEntered || error?.result?.terminationConfirmed === true)
      ) {
        try {
          const retrying = await transition('queued', {
            retry: {
              code:
                typeof error?.code === 'string'
                  ? error.code
                  : 'adapter_failed',
              terminationConfirmed: true,
            },
          })
          return { status: 'retrying', job: retrying }
        } catch (retryError) {
          this.logger?.warn?.('Fleet retry transition failed.', {
            jobId: job.id,
            code: retryError?.code || 'unknown',
          })
        }
      }
      try {
        const failed = await transition('failed')
        return { status: 'failed', job: failed }
      } catch (terminalError) {
        this.logger?.warn?.('Fleet failure transition failed.', {
          jobId: job.id,
          code: terminalError?.code || 'unknown',
        })
        return { status: 'abandoned', jobId: job.id }
      }
    } finally {
      lifecycleSignal?.removeEventListener?.('abort', onLifecycleAbort)
      active.settling = true
      if (active.renewTimer) this.clearTimeout(active.renewTimer)
      active.renewTimer = null
      if (active.expiryTimer) this.clearTimeout(active.expiryTimer)
      const pendingRenewal = active.renewOperation
      if (pendingRenewal) {
        await pendingRenewal.catch((error) => {
          this.logger?.warn?.('Fleet settlement awaited a failed renewal.', {
            jobId: job.id,
            code: error?.code || 'unknown',
          })
        })
      }
      if (
        cleanupAllowed &&
        adapterContext &&
        typeof adapter?.cleanup === 'function'
      ) {
        try {
          await adapter.cleanup(adapterContext)
        } catch (error) {
          this.logger?.warn?.('Fleet workspace cleanup failed.', {
            jobId: job.id,
            code: error?.code || 'unknown',
          })
        }
      }
      if (
        cleanupAllowed &&
        authorityFenceWritten &&
        this.onLeaseAuthoritySettled
      ) {
        try {
          await this.onLeaseAuthoritySettled({
            jobId: job.id,
            leaseId: lease.id,
          })
          authorityFenceWritten = false
        } catch (error) {
          authorityFenceFailed = true
          this.logger?.error?.('Fleet lease-authority fence could not be cleared.', {
            jobId: job.id,
            code: error?.code || 'unknown',
          })
        }
      }
      if (
        cleanupAllowed &&
        !authorityFenceFailed &&
        executionMarkerWritten &&
        this.onExecutionSettled
      ) {
        try {
          await this.onExecutionSettled({
            jobId: job.id,
            attempt: Number(job.attempt || lease.attempt || 0),
          })
          executionMarkerWritten = false
        } catch (error) {
          executionMarkerFailed = true
          this.logger?.error?.('Fleet active-job marker could not be cleared.', {
            jobId: job.id,
            code: error?.code || 'unknown',
          })
        }
      }
      if (executionMarkerFailed) {
        this.pauseForTrustLoss('worker-marker-unavailable')
      } else if (authorityFenceFailed) {
        this.pauseForTrustLoss('worker-authority-fence-unavailable')
      }
      if (this.active === active) this.active = null
    }
  }

  start() {
    if (
      this.running ||
      this.pausedReason ||
      this.lifecycleController.signal.aborted
    ) {
      return
    }
    this.running = true
    const scheduleHeartbeat = (delay) => {
      this.heartbeatTimer = this.setTimeout(async () => {
        try {
          const operation = this.heartbeatOnce(this.lifecycleController.signal)
          this.heartbeatOperation = operation
          await operation
        } catch (error) {
          this.logger?.warn?.('Fleet heartbeat failed.', {
            code: error?.code || 'unknown',
          })
        } finally {
          this.heartbeatOperation = null
        }
        if (this.running) scheduleHeartbeat(this.heartbeatIntervalMs)
      }, delay)
    }
    const schedulePoll = (delay) => {
      this.pollTimer = this.setTimeout(async () => {
        let nextDelay = this.pollIntervalMs
        try {
          const operation = this.runOnce(this.lifecycleController.signal)
          this.pollOperation = operation
          const result = await operation
          if (result.status === 'idle') nextDelay = result.retryAfterMs
        } catch (error) {
          this.logger?.warn?.('Fleet job poll failed.', {
            code: error?.code || 'unknown',
          })
        } finally {
          this.pollOperation = null
        }
        if (this.running) schedulePoll(nextDelay)
      }, delay)
    }
    scheduleHeartbeat(0)
    schedulePoll(0)
  }

  async stop() {
    this.running = false
    if (this.pollTimer) this.clearTimeout(this.pollTimer)
    if (this.heartbeatTimer) this.clearTimeout(this.heartbeatTimer)
    this.pollTimer = null
    this.heartbeatTimer = null
    if (!this.lifecycleController.signal.aborted) {
      this.lifecycleController.abort({ code: 'local-stop' })
    }
    if (this.active && !this.active.controller.signal.aborted) {
      this.active.controller.abort({ code: 'local-stop' })
    }
    const operations = [this.pollOperation, this.heartbeatOperation].filter(
      Boolean
    )
    if (operations.length > 0) await Promise.allSettled(operations)
  }
}

module.exports = {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RENEW_INTERVAL_MS,
  FleetNodeSupervisor,
  authorizationLost,
  coordinatorTrustLost,
  publicFailure,
  retryableError,
}
