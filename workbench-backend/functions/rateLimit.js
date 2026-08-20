const {createHash} = require("node:crypto");

async function enforceRateLimit({
  db,
  uid,
  action,
  limit,
  windowSeconds,
  now = Date.now(),
  Timestamp,
}) {
  const windowMs = windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  const id = createHash("sha256")
      .update(`${uid}:${action}:${bucket}`)
      .digest("hex");
  const ref = db.doc(`rateLimits/${id}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const count = Number(snapshot.data()?.count || 0);
    if (count >= limit) {
      const error = new Error("Too many workspace requests. Wait and try again.");
      error.code = "resource_exhausted";
      error.status = 429;
      throw error;
    }
    transaction.set(ref, {
      uidHash: createHash("sha256").update(uid).digest("hex"),
      action,
      bucket,
      count: count + 1,
      expiresAt: Timestamp.fromMillis((bucket + 2) * windowMs),
      updatedAt: Timestamp.fromMillis(now),
    }, {merge: true});
  });
}

module.exports = {enforceRateLimit};
