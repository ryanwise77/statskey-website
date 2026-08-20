param(
  [Parameter(Mandatory = $false)]
  [string]$Payload
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($Payload)) {
  $Payload = [Console]::In.ReadToEnd()
}
if ($Payload.Length -gt 24000 -or $Payload -notmatch '^[A-Za-z0-9_-]+$') {
  throw 'The process-owner payload is invalid.'
}

$base64 = $Payload.Replace('-', '+').Replace('_', '/')
switch ($base64.Length % 4) {
  2 { $base64 += '==' }
  3 { $base64 += '=' }
  1 { throw 'The process-owner payload is invalid.' }
}
$decoded = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($base64)
)
$request = $decoded | ConvertFrom-Json
if (
  $null -eq $request -or
  $request.executable -isnot [string] -or
  $null -eq $request.arguments -or
  $null -eq $request.parentProcessId -or
  $null -eq $request.parentStartedUnixMilliseconds -or
  $null -eq $request.deadlineUnixMilliseconds -or
  $request.authorityFencePath -isnot [string] -or
  $request.ownerLockPath -isnot [string] -or
  $request.authorityLeaseId -isnot [string] -or
  $request.authorityToken -isnot [string] -or
  $request.authorityKey -isnot [string] -or
  $null -eq $request.maximumAuthorityDeadlineUnixMilliseconds
) {
  throw 'The process-owner request is invalid.'
}
$arguments = @($request.arguments | ForEach-Object {
  if ($_ -isnot [string]) {
    throw 'A process-owner argument is invalid.'
  }
  [string]$_
})
if ($arguments.Count -gt 128) {
  throw 'The process-owner request has too many arguments.'
}
[int]$parentProcessId = 0
[long]$parentStartedUnixMilliseconds = 0
[long]$deadlineUnixMilliseconds = 0
[long]$maximumAuthorityDeadlineUnixMilliseconds = 0
if (
  -not [int]::TryParse(
    [string]$request.parentProcessId,
    [ref]$parentProcessId
  ) -or
  $parentProcessId -lt 1 -or
  -not [long]::TryParse(
    [string]$request.parentStartedUnixMilliseconds,
    [ref]$parentStartedUnixMilliseconds
  ) -or
  $parentStartedUnixMilliseconds -lt 1 -or
  -not [long]::TryParse(
    [string]$request.deadlineUnixMilliseconds,
    [ref]$deadlineUnixMilliseconds
  ) -or
  -not [long]::TryParse(
    [string]$request.maximumAuthorityDeadlineUnixMilliseconds,
    [ref]$maximumAuthorityDeadlineUnixMilliseconds
  ) -or
  $maximumAuthorityDeadlineUnixMilliseconds -lt $deadlineUnixMilliseconds
) {
  throw 'The process-owner lifetime is invalid.'
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace StatsKeyFleet {
  public static class ProcessOwner {
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_TIMEOUT = 0x00000102;
    private const uint WAIT_AUTHORITY_LOST = 0xFFFFFFFE;
    private const uint WAIT_FAILED = 0xFFFFFFFF;
    private const int STD_INPUT_HANDLE = -10;
    private const int STD_OUTPUT_HANDLE = -11;
    private const int STD_ERROR_HANDLE = -12;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
      public long PerProcessUserTimeLimit;
      public long PerJobUserTimeLimit;
      public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize;
      public UIntPtr MaximumWorkingSetSize;
      public uint ActiveProcessLimit;
      public UIntPtr Affinity;
      public uint PriorityClass;
      public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS {
      public ulong ReadOperationCount;
      public ulong WriteOperationCount;
      public ulong OtherOperationCount;
      public ulong ReadTransferCount;
      public ulong WriteTransferCount;
      public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
      public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
      public IO_COUNTERS IoInfo;
      public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed;
      public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
      public long TotalUserTime;
      public long TotalKernelTime;
      public long ThisPeriodTotalUserTime;
      public long ThisPeriodTotalKernelTime;
      public uint TotalPageFaultCount;
      public uint TotalProcesses;
      public uint ActiveProcesses;
      public uint TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
      public uint cb;
      public string lpReserved;
      public string lpDesktop;
      public string lpTitle;
      public uint dwX;
      public uint dwY;
      public uint dwXSize;
      public uint dwYSize;
      public uint dwXCountChars;
      public uint dwYCountChars;
      public uint dwFillAttribute;
      public uint dwFlags;
      public short wShowWindow;
      public short cbReserved2;
      public IntPtr lpReserved2;
      public IntPtr hStdInput;
      public IntPtr hStdOutput;
      public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
      public IntPtr hProcess;
      public IntPtr hThread;
      public uint dwProcessId;
      public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME {
      public uint LowDateTime;
      public uint HighDateTime;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(
      IntPtr jobAttributes,
      string name
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
      IntPtr job,
      int informationClass,
      ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
      uint informationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
      IntPtr job,
      int informationClass,
      ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information,
      uint informationLength,
      IntPtr returnLength
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
      string applicationName,
      StringBuilder commandLine,
      IntPtr processAttributes,
      IntPtr threadAttributes,
      bool inheritHandles,
      uint creationFlags,
      IntPtr environment,
      string currentDirectory,
      ref STARTUPINFO startupInfo,
      out PROCESS_INFORMATION processInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(
      IntPtr job,
      IntPtr process
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint timeout);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(
      uint count,
      [In] IntPtr[] handles,
      bool waitAll,
      uint timeout
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(
      uint desiredAccess,
      bool inheritHandle,
      uint processId
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(
      IntPtr process,
      out FILETIME creationTime,
      out FILETIME exitTime,
      out FILETIME kernelTime,
      out FILETIME userTime
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(
      IntPtr process,
      out uint exitCode
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    public static int Run(
      string executable,
      string[] arguments,
      int parentProcessId,
      long parentStartedUnixMilliseconds,
      long deadlineUnixMilliseconds,
      string authorityFencePath,
      string ownerLockPath,
      string authorityLeaseId,
      string authorityToken,
      string authorityKey,
      long maximumAuthorityDeadlineUnixMilliseconds
    ) {
      if (
        String.IsNullOrWhiteSpace(executable) ||
        !Path.IsPathRooted(executable) ||
        executable.StartsWith(@"\\", StringComparison.Ordinal) ||
        !File.Exists(executable)
      ) {
        throw new InvalidOperationException(
          "The owned executable must be a pinned local path."
        );
      }
      long nowUnixMilliseconds = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      if (
        parentProcessId < 1 ||
        parentStartedUnixMilliseconds < 1 ||
        deadlineUnixMilliseconds <= nowUnixMilliseconds ||
        deadlineUnixMilliseconds - nowUnixMilliseconds > 43200000 ||
        maximumAuthorityDeadlineUnixMilliseconds < deadlineUnixMilliseconds ||
        maximumAuthorityDeadlineUnixMilliseconds - nowUnixMilliseconds >
          43200000 ||
        String.IsNullOrWhiteSpace(ownerLockPath) ||
        ownerLockPath.Length > 1024 ||
        !Path.IsPathRooted(ownerLockPath) ||
        ownerLockPath.StartsWith(@"\\", StringComparison.Ordinal) ||
        !ValidAuthorityIdentity(
          authorityFencePath,
          authorityLeaseId,
          authorityToken,
          authorityKey
        )
      ) {
        throw new InvalidOperationException(
          "The owned process lifetime is invalid."
        );
      }
      FileStream ownerLock = new FileStream(
        ownerLockPath,
        FileMode.OpenOrCreate,
        FileAccess.ReadWrite,
        FileShare.None
      );
      VerifyAuthorityFence(
        authorityFencePath,
        authorityLeaseId,
        authorityToken,
        authorityKey,
        maximumAuthorityDeadlineUnixMilliseconds
      );

      IntPtr parent = OpenProcess(
        SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
        false,
        unchecked((uint)parentProcessId)
      );
      if (parent == IntPtr.Zero) ThrowLastWin32("OpenProcess");
      try {
        VerifyParentIdentity(parent, parentStartedUnixMilliseconds);
      } catch {
        CloseHandle(parent);
        throw;
      }
      if (WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) {
        CloseHandle(parent);
        throw new InvalidOperationException(
          "The Fleet desktop parent process already exited."
        );
      }
      IntPtr job = IntPtr.Zero;

      PROCESS_INFORMATION child = new PROCESS_INFORMATION();
      bool childCreated = false;
      bool childAssigned = false;
      bool childCompleted = false;
      try {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) ThrowLastWin32("CreateJobObject");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
          new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags =
          JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(
          job,
          JobObjectExtendedLimitInformation,
          ref limits,
          (uint)Marshal.SizeOf(limits)
        )) {
          ThrowLastWin32("SetInformationJobObject");
        }

        STARTUPINFO startup = new STARTUPINFO();
        startup.cb = (uint)Marshal.SizeOf(startup);
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);

        StringBuilder commandLine = new StringBuilder();
        commandLine.Append(QuoteArgument(executable));
        foreach (string argument in arguments ?? new string[0]) {
          commandLine.Append(' ');
          commandLine.Append(QuoteArgument(argument));
        }

        if (!CreateProcess(
          executable,
          commandLine,
          IntPtr.Zero,
          IntPtr.Zero,
          true,
          CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
          IntPtr.Zero,
          Directory.GetCurrentDirectory(),
          ref startup,
          out child
        )) {
          ThrowLastWin32("CreateProcess");
        }
        childCreated = true;

        if (!AssignProcessToJobObject(job, child.hProcess)) {
          ThrowLastWin32("AssignProcessToJobObject");
        }
        childAssigned = true;
        if (ResumeThread(child.hThread) == UInt32.MaxValue) {
          ThrowLastWin32("ResumeThread");
        }
        uint waitResult = WaitForOwnedProcess(
          child.hProcess,
          parent,
          deadlineUnixMilliseconds,
          authorityFencePath,
          authorityLeaseId,
          authorityToken,
          authorityKey,
          maximumAuthorityDeadlineUnixMilliseconds
        );
        if (waitResult == WAIT_OBJECT_0 + 1) {
          TerminateAndConfirmJob(job);
          childCompleted = true;
          throw new InvalidOperationException(
            "The Fleet desktop parent process exited."
          );
        }
        if (waitResult == WAIT_TIMEOUT) {
          TerminateAndConfirmJob(job);
          childCompleted = true;
          throw new TimeoutException("The owned process exceeded its deadline.");
        }
        if (waitResult == WAIT_AUTHORITY_LOST) {
          TerminateAndConfirmJob(job);
          childCompleted = true;
          throw new InvalidOperationException(
            "The Fleet lease authority expired."
          );
        }
        uint exitCode;
        if (!GetExitCodeProcess(child.hProcess, out exitCode)) {
          ThrowLastWin32("GetExitCodeProcess");
        }
        TerminateAndConfirmJob(job);
        childCompleted = true;
        return unchecked((int)exitCode);
      } finally {
        if (childCreated && !childCompleted) {
          if (childAssigned) {
            TerminateAndConfirmJob(job);
          } else if (child.hProcess != IntPtr.Zero) {
            TerminateAndConfirmProcess(child.hProcess);
          }
        }
        if (child.hThread != IntPtr.Zero) CloseHandle(child.hThread);
        if (child.hProcess != IntPtr.Zero) CloseHandle(child.hProcess);
        // This is the containment boundary: closing a kill-on-close Job Object
        // terminates every descendant before the wrapper itself can exit.
        if (job != IntPtr.Zero) CloseHandle(job);
        CloseHandle(parent);
        ownerLock.Dispose();
      }
    }

    private static uint WaitForOwnedProcess(
      IntPtr child,
      IntPtr parent,
      long deadlineUnixMilliseconds,
      string authorityFencePath,
      string authorityLeaseId,
      string authorityToken,
      string authorityKey,
      long maximumAuthorityDeadlineUnixMilliseconds
    ) {
      while (true) {
        long remaining =
          deadlineUnixMilliseconds -
          DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (remaining <= 0) return WAIT_TIMEOUT;
        uint timeout = unchecked((uint)Math.Min(remaining, 250L));
        uint result = WaitForMultipleObjects(
          2,
          new IntPtr[] { child, parent },
          false,
          timeout
        );
        if (result == WAIT_FAILED) ThrowLastWin32("WaitForMultipleObjects");
        if (result == WAIT_OBJECT_0 || result == WAIT_OBJECT_0 + 1) {
          return result;
        }
        if (result != WAIT_TIMEOUT) {
          throw new InvalidOperationException(
            "The owned process wait returned an invalid result."
          );
        }
        if (!AuthorityFenceIsCurrent(
          authorityFencePath,
          authorityLeaseId,
          authorityToken,
          authorityKey,
          maximumAuthorityDeadlineUnixMilliseconds
        )) {
          return WAIT_AUTHORITY_LOST;
        }
      }
    }

    private static bool ValidAuthorityIdentity(
      string authorityFencePath,
      string authorityLeaseId,
      string authorityToken,
      string authorityKey
    ) {
      if (
        String.IsNullOrWhiteSpace(authorityFencePath) ||
        authorityFencePath.Length > 1024 ||
        !Path.IsPathRooted(authorityFencePath) ||
        authorityFencePath.StartsWith(@"\\", StringComparison.Ordinal) ||
        String.IsNullOrWhiteSpace(authorityLeaseId) ||
        authorityLeaseId.Length != 38 ||
        !authorityLeaseId.StartsWith("lease_", StringComparison.Ordinal) ||
        String.IsNullOrWhiteSpace(authorityToken) ||
        authorityToken.Length < 32 ||
        authorityToken.Length > 128 ||
        String.IsNullOrWhiteSpace(authorityKey) ||
        authorityKey.Length != 43
      ) {
        return false;
      }
      foreach (char character in authorityLeaseId.Substring(6)) {
        if (
          (character < '0' || character > '9') &&
          (character < 'a' || character > 'f')
        ) {
          return false;
        }
      }
      foreach (char character in authorityToken) {
        if (
          (character < '0' || character > '9') &&
          (character < 'A' || character > 'Z') &&
          (character < 'a' || character > 'z') &&
          character != '_' &&
          character != '-'
        ) {
          return false;
        }
      }
      foreach (char character in authorityKey) {
        if (
          (character < '0' || character > '9') &&
          (character < 'A' || character > 'Z') &&
          (character < 'a' || character > 'z') &&
          character != '_' &&
          character != '-'
        ) {
          return false;
        }
      }
      try {
        if (DecodeBase64Url(authorityKey).Length != 32) return false;
      } catch {
        return false;
      }
      return true;
    }

    private static void VerifyAuthorityFence(
      string authorityFencePath,
      string authorityLeaseId,
      string authorityToken,
      string authorityKey,
      long maximumAuthorityDeadlineUnixMilliseconds
    ) {
      if (!AuthorityFenceIsCurrent(
        authorityFencePath,
        authorityLeaseId,
        authorityToken,
        authorityKey,
        maximumAuthorityDeadlineUnixMilliseconds
      )) {
        throw new InvalidOperationException(
          "The Fleet lease authority is unavailable."
        );
      }
    }

    private static bool AuthorityFenceIsCurrent(
      string authorityFencePath,
      string authorityLeaseId,
      string authorityToken,
      string authorityKey,
      long maximumAuthorityDeadlineUnixMilliseconds
    ) {
      for (int attempt = 0; attempt < 2; attempt += 1) {
        try {
          FileAttributes attributes = File.GetAttributes(authorityFencePath);
          if ((attributes & FileAttributes.ReparsePoint) != 0) return false;
          using (FileStream stream = new FileStream(
            authorityFencePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete
          )) {
            if (stream.Length < 1 || stream.Length > 1024) return false;
            List<string> lines = new List<string>();
            using (StreamReader reader = new StreamReader(
              stream,
              Encoding.UTF8,
              true,
              1024,
              true
            )) {
              string line;
              while ((line = reader.ReadLine()) != null) {
                lines.Add(line);
                if (lines.Count > 6) return false;
              }
            }
            if (
              lines.Count == 6 &&
              FixedTimeEquals(lines[0], "statskey-fleet-authority-v1") &&
              FixedTimeEquals(lines[1], authorityLeaseId) &&
              FixedTimeEquals(lines[2], authorityToken) &&
              ValidAuthoritySignature(lines, authorityKey)
            ) {
              long expiresUnixMilliseconds;
              long deadlineUnixMilliseconds;
              if (
                Int64.TryParse(lines[3], out expiresUnixMilliseconds) &&
                Int64.TryParse(lines[4], out deadlineUnixMilliseconds)
              ) {
                long nowUnixMilliseconds =
                  DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (
                  expiresUnixMilliseconds > nowUnixMilliseconds &&
                  deadlineUnixMilliseconds > nowUnixMilliseconds &&
                  expiresUnixMilliseconds <= deadlineUnixMilliseconds &&
                  deadlineUnixMilliseconds <=
                    maximumAuthorityDeadlineUnixMilliseconds
                ) {
                  return true;
                }
              }
            }
          }
        } catch {
          if (attempt == 1) return false;
        }
        Thread.Yield();
      }
      return false;
    }

    private static bool ValidAuthoritySignature(
      List<string> lines,
      string authorityKey
    ) {
      try {
        string signedValue = String.Join("\n", lines.GetRange(0, 5).ToArray());
        byte[] signature;
        using (HMACSHA256 hmac = new HMACSHA256(
          DecodeBase64Url(authorityKey)
        )) {
          signature = hmac.ComputeHash(Encoding.UTF8.GetBytes(signedValue));
        }
        string expected = Convert.ToBase64String(signature)
          .TrimEnd('=')
          .Replace('+', '-')
          .Replace('/', '_');
        return FixedTimeEquals(lines[5], expected);
      } catch {
        return false;
      }
    }

    private static byte[] DecodeBase64Url(string value) {
      string base64 = value.Replace('-', '+').Replace('_', '/');
      switch (base64.Length % 4) {
        case 0:
          break;
        case 2:
          base64 += "==";
          break;
        case 3:
          base64 += "=";
          break;
        default:
          throw new FormatException("Invalid base64url data.");
      }
      return Convert.FromBase64String(base64);
    }

    private static bool FixedTimeEquals(string left, string right) {
      if (left == null || right == null) return false;
      int difference = left.Length ^ right.Length;
      int maximum = Math.Max(left.Length, right.Length);
      for (int index = 0; index < maximum; index += 1) {
        char leftCharacter = index < left.Length ? left[index] : (char)0;
        char rightCharacter = index < right.Length ? right[index] : (char)0;
        difference |= leftCharacter ^ rightCharacter;
      }
      return difference == 0;
    }

    private static void VerifyParentIdentity(
      IntPtr parent,
      long expectedStartedUnixMilliseconds
    ) {
      FILETIME creation;
      FILETIME exit;
      FILETIME kernel;
      FILETIME user;
      if (!GetProcessTimes(
        parent,
        out creation,
        out exit,
        out kernel,
        out user
      )) {
        ThrowLastWin32("GetProcessTimes");
      }
      ulong windowsTicks =
        ((ulong)creation.HighDateTime << 32) | creation.LowDateTime;
      long actualStartedUnixMilliseconds =
        unchecked((long)(windowsTicks / 10000UL)) - 11644473600000L;
      if (
        Math.Abs(
          actualStartedUnixMilliseconds - expectedStartedUnixMilliseconds
        ) > 5000
      ) {
        throw new InvalidOperationException(
          "The Fleet desktop parent identity changed."
        );
      }
    }

    private static string QuoteArgument(string value) {
      value = value ?? String.Empty;
      if (
        value.Length > 0 &&
        value.IndexOfAny(new char[] {' ', '\t', '\n', '\v', '"'}) < 0
      ) {
        return value;
      }
      StringBuilder result = new StringBuilder();
      result.Append('"');
      int backslashes = 0;
      foreach (char character in value) {
        if (character == '\\') {
          backslashes += 1;
          continue;
        }
        if (character == '"') {
          result.Append('\\', backslashes * 2 + 1);
          result.Append('"');
          backslashes = 0;
          continue;
        }
        result.Append('\\', backslashes);
        backslashes = 0;
        result.Append(character);
      }
      result.Append('\\', backslashes * 2);
      result.Append('"');
      return result.ToString();
    }

    private static void TerminateAndConfirmJob(IntPtr job) {
      JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting =
        ReadJobAccounting(job);
      if (accounting.ActiveProcesses == 0) return;
      if (!TerminateJobObject(job, 1)) {
        ThrowLastWin32("TerminateJobObject");
      }
      Stopwatch deadline = Stopwatch.StartNew();
      while (deadline.ElapsedMilliseconds < 5000) {
        if (ReadJobAccounting(job).ActiveProcesses == 0) return;
        Thread.Sleep(25);
      }
      throw new InvalidOperationException(
        "The Windows process tree did not terminate."
      );
    }

    private static void TerminateAndConfirmProcess(IntPtr process) {
      if (!TerminateProcess(process, 1)) {
        int error = Marshal.GetLastWin32Error();
        uint alreadyExited = WaitForSingleObject(process, 0);
        if (alreadyExited != WAIT_OBJECT_0) {
          throw new Win32Exception(error, "TerminateProcess failed.");
        }
        return;
      }
      uint result = WaitForSingleObject(process, 5000);
      if (result == WAIT_FAILED) ThrowLastWin32("WaitForSingleObject");
      if (result != WAIT_OBJECT_0) {
        throw new InvalidOperationException(
          "The Windows process did not terminate."
        );
      }
    }

    private static JOBOBJECT_BASIC_ACCOUNTING_INFORMATION ReadJobAccounting(
      IntPtr job
    ) {
      JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting =
        new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
      if (!QueryInformationJobObject(
        job,
        JobObjectBasicAccountingInformation,
        ref accounting,
        (uint)Marshal.SizeOf(accounting),
        IntPtr.Zero
      )) {
        ThrowLastWin32("QueryInformationJobObject");
      }
      return accounting;
    }

    private static void ThrowLastWin32(string operation) {
      throw new Win32Exception(
        Marshal.GetLastWin32Error(),
        operation + " failed."
      );
    }
  }
}
'@

$exitCode = [StatsKeyFleet.ProcessOwner]::Run(
  [string]$request.executable,
  [string[]]$arguments,
  $parentProcessId,
  $parentStartedUnixMilliseconds,
  $deadlineUnixMilliseconds,
  [string]$request.authorityFencePath,
  [string]$request.ownerLockPath,
  [string]$request.authorityLeaseId,
  [string]$request.authorityToken,
  [string]$request.authorityKey,
  $maximumAuthorityDeadlineUnixMilliseconds
)
exit $exitCode
