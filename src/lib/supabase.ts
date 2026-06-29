type Filter = {
  op: "eq" | "neq" | "in" | "gte" | "lte";
  field: string;
  value: unknown;
};

type QueryBody = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  select?: string;
  payload?: unknown;
  filters: Filter[];
  order?: { field: string; ascending?: boolean; nullsFirst?: boolean };
  limit?: number;
  single?: boolean;
  maybeSingle?: boolean;
  returning?: boolean;
};

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "";
const tokenKey = "radar_auth_token";

function authHeaders() {
  const token = localStorage.getItem(tokenKey);
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Falha na comunicacao com a API.");
  }
  return body;
}

class QueryBuilder {
  private body: QueryBody;

  constructor(table: string) {
    this.body = {
      table,
      action: "select",
      filters: [],
    };
  }

  select(columns = "*") {
    this.body.select = columns;
    if (this.body.action !== "select") this.body.returning = true;
    return this;
  }

  insert(payload: unknown) {
    this.body.action = "insert";
    this.body.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.body.action = "update";
    this.body.payload = payload;
    return this;
  }

  delete() {
    this.body.action = "delete";
    return this;
  }

  eq(field: string, value: unknown) {
    this.body.filters.push({ op: "eq", field, value });
    return this;
  }

  neq(field: string, value: unknown) {
    this.body.filters.push({ op: "neq", field, value });
    return this;
  }

  in(field: string, value: unknown[]) {
    this.body.filters.push({ op: "in", field, value });
    return this;
  }

  gte(field: string, value: unknown) {
    this.body.filters.push({ op: "gte", field, value });
    return this;
  }

  lte(field: string, value: unknown) {
    this.body.filters.push({ op: "lte", field, value });
    return this;
  }

  order(field: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.body.order = { field, ...options };
    return this;
  }

  limit(value: number) {
    this.body.limit = value;
    return this;
  }

  single() {
    this.body.single = true;
    return this;
  }

  maybeSingle() {
    this.body.maybeSingle = true;
    return this;
  }

  async execute() {
    try {
      const response = await apiFetch("/api/query", {
        method: "POST",
        body: JSON.stringify(this.body),
      });
      return { data: response.data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export const localAuth = {
  tokenKey,
  async login(email: string, senha: string) {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    });
    localStorage.setItem(tokenKey, response.token);
    return response.user;
  },
  async me() {
    const token = localStorage.getItem(tokenKey);
    if (!token) return null;
    try {
      const response = await apiFetch("/api/auth/me");
      return response.user;
    } catch {
      localStorage.removeItem(tokenKey);
      return null;
    }
  },
  logout() {
    localStorage.removeItem(tokenKey);
  },
};

export const supabase = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  functions: {
    async invoke(name: string, options: { body?: unknown } = {}) {
      try {
        const response = await apiFetch(`/api/functions/${name}`, {
          method: "POST",
          body: JSON.stringify(options.body ?? {}),
        });
        return { data: response, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  },
};
