class FakeDb {
  constructor() {
    this.docs = new Map();
  }

  doc(path) {
    return new FakeRef(this, path);
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  batch() {
    return new FakeBatch(this);
  }

  async runTransaction(operation) {
    const batch = new FakeBatch(this);
    const result = await operation(batch);
    await batch.commit();
    return result;
  }
}

class FakeQuery {
  constructor(
      db,
      path,
      filters = [],
      ordering = null,
      maximum = null,
      afterId = null,
  ) {
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.ordering = ordering;
    this.maximum = maximum;
    this.afterId = afterId;
  }

  where(field, operator, value) {
    if (!["==", ">", ">=", "<", "<="].includes(operator)) {
      throw new Error(`Unsupported fake query operator: ${operator}`);
    }
    return new FakeQuery(
        this.db,
        this.path,
        [...this.filters, {field, operator, value}],
        this.ordering,
        this.maximum,
        this.afterId,
    );
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(
        this.db,
        this.path,
        this.filters,
        {field, direction},
        this.maximum,
        this.afterId,
    );
  }

  limit(maximum) {
    return new FakeQuery(
        this.db,
        this.path,
        this.filters,
        this.ordering,
        maximum,
        this.afterId,
    );
  }

  startAfter(snapshot) {
    return new FakeQuery(
        this.db,
        this.path,
        this.filters,
        this.ordering,
        this.maximum,
        typeof snapshot === "string" ? snapshot : snapshot?.id || null,
    );
  }

  async get() {
    const prefix = `${this.path}/`;
    let rows = [...this.db.docs.entries()]
        .filter(([path]) => {
          if (!path.startsWith(prefix)) return false;
          return !path.slice(prefix.length).includes("/");
        })
        .map(([path, value]) => ({
          id: path.slice(prefix.length),
          ref: new FakeRef(this.db, path),
          data: () => value,
        }));
    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const actual = nestedValue(row.data(), filter.field);
        if (filter.operator === "==") return actual === filter.value;
        if (filter.operator === ">") {
          return comparable(actual) > comparable(filter.value);
        }
        if (filter.operator === ">=") {
          return comparable(actual) >= comparable(filter.value);
        }
        if (filter.operator === "<") {
          return comparable(actual) < comparable(filter.value);
        }
        if (filter.operator === "<=") {
          return comparable(actual) <= comparable(filter.value);
        }
        throw new Error(`Unsupported fake query operator ${filter.operator}`);
      });
    }
    if (this.ordering) {
      const {field, direction} = this.ordering;
      rows.sort((left, right) => {
        const a = comparable(nestedValue(left.data(), field));
        const b = comparable(nestedValue(right.data(), field));
        const order = a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id);
        return direction === "desc" ? -order : order;
      });
    }
    if (this.afterId) {
      const index = rows.findIndex((row) => row.id === this.afterId);
      rows = index < 0 ?
        rows.filter((row) => row.id > this.afterId) :
        rows.slice(index + 1);
    }
    if (Number.isInteger(this.maximum)) rows = rows.slice(0, this.maximum);
    return {docs: rows, empty: rows.length === 0};
  }
}

function nestedValue(value, field) {
  return String(field)
      .split(".")
      .reduce((current, key) => current?.[key], value);
}

function comparable(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return value;
}

class FakeRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  async get() {
    const value = this.db.docs.get(this.path);
    return {
      id: this.path.split("/").at(-1),
      ref: this,
      exists: value !== undefined,
      data: () => value,
    };
  }

  async set(value, options = {}) {
    const current = options.merge ? this.db.docs.get(this.path) || {} : {};
    this.db.docs.set(this.path, {...current, ...value});
  }
}

class FakeBatch {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }

  async get(ref) {
    return ref.get();
  }

  set(ref, value, options = {}) {
    this.operations.push(() => {
      const current = options.merge ? this.db.docs.get(ref.path) || {} : {};
      this.db.docs.set(ref.path, {...current, ...value});
    });
  }

  delete(ref) {
    this.operations.push(() => this.db.docs.delete(ref.path));
  }

  async commit() {
    for (const operation of this.operations) operation();
    this.operations = [];
  }
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

module.exports = {FakeDb, fakeResponse};
