import { query } from "./db.mjs";

const tableMap = {
  profiles: "usuarios",
  usuarios: "usuarios",
  familias: "familias",
  concorrentes: "concorrentes",
  produtos: "produtos",
  mapeamentos_sku: "mapeamentos_sku",
  historico_precos: "historico_precos",
  execucoes_robo: "execucoes_robo",
  agenda_coletas: "agenda_coletas",
  app_config: "app_config",
};

const allowedColumns = {
  usuarios: ["nome", "email", "password_hash", "role", "ativo"],
  familias: ["nome", "descricao", "ativo"],
  concorrentes: ["nome", "site_url", "login_url", "tipo_consulta", "observacoes", "ativo"],
  produtos: ["sku_interno", "nome", "familia_id", "unidade", "preco_atual", "observacoes", "ativo"],
  mapeamentos_sku: [
    "produto_id",
    "concorrente_id",
    "sku_concorrente",
    "url_produto",
    "unidade_equivalente",
    "seletor_preco",
    "observacoes",
    "ativo",
    "ultimo_preco",
    "ultima_atualizacao",
    "status_coleta",
  ],
  historico_precos: [
    "mapeamento_id",
    "preco_construjota",
    "preco_concorrente",
    "diferenca_valor",
    "diferenca_percentual",
    "status",
    "mensagem_erro",
    "coletado_em",
  ],
  execucoes_robo: [
    "status",
    "origem",
    "iniciado_em",
    "finalizado_em",
    "total_processados",
    "total_sucesso",
    "total_erro",
    "mensagem",
    "tempo_execucao_segundos",
  ],
  agenda_coletas: [
    "familia_id",
    "ativo",
    "horario",
    "dias_semana",
    "concorrencia_maxima",
    "observacoes",
    "ultima_execucao",
    "ultimo_status",
    "ultimo_erro",
  ],
};

const numericFields = new Set([
  "preco_atual",
  "ultimo_preco",
  "preco_construjota",
  "preco_concorrente",
  "diferenca_valor",
  "diferenca_percentual",
  "concorrencia_maxima",
]);

function normalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (numericFields.has(key) && item !== null && item !== undefined) {
      next[key] = Number(item);
    } else {
      next[key] = normalize(item);
    }
  }
  return next;
}

function resolveTable(table) {
  const resolved = tableMap[table];
  if (!resolved) throw new Error(`Tabela nao permitida: ${table}`);
  return resolved;
}

function baseSelect(table) {
  if (table === "usuarios") {
    return `
      select id,nome,email,role,ativo,created_at
      from usuarios
    `;
  }

  if (table === "produtos") {
    return `
      select p.*,
        case when f.id is null then null else json_build_object('id', f.id, 'nome', f.nome) end as familias
      from produtos p
      left join familias f on f.id = p.familia_id
    `;
  }

  if (table === "mapeamentos_sku") {
    return `
      select m.*,
        json_build_object(
          'id', p.id,
          'nome', p.nome,
          'sku_interno', p.sku_interno,
          'familia_id', p.familia_id,
          'preco_atual', p.preco_atual,
          'ativo', p.ativo,
          'familias', case when f.id is null then null else json_build_object('id', f.id, 'nome', f.nome) end
        ) as produtos,
        json_build_object(
          'id', c.id,
          'nome', c.nome,
          'site_url', c.site_url,
          'login_url', c.login_url,
          'ativo', c.ativo
        ) as concorrentes
      from mapeamentos_sku m
      join produtos p on p.id = m.produto_id
      left join familias f on f.id = p.familia_id
      join concorrentes c on c.id = m.concorrente_id
    `;
  }

  if (table === "historico_precos") {
    return `
      select h.*,
        json_build_object(
          'id', m.id,
          'sku_concorrente', m.sku_concorrente,
          'produtos', json_build_object(
            'id', p.id,
            'nome', p.nome,
            'sku_interno', p.sku_interno,
            'familia_id', p.familia_id,
            'preco_atual', p.preco_atual,
            'familias', case when f.id is null then null else json_build_object('id', f.id, 'nome', f.nome) end
          ),
          'concorrentes', json_build_object('id', c.id, 'nome', c.nome)
        ) as mapeamentos_sku
      from historico_precos h
      join mapeamentos_sku m on m.id = h.mapeamento_id
      join produtos p on p.id = m.produto_id
      left join familias f on f.id = p.familia_id
      join concorrentes c on c.id = m.concorrente_id
    `;
  }

  if (table === "agenda_coletas") {
    return `
      select a.*,
        case when f.id is null then null else json_build_object('id', f.id, 'nome', f.nome, 'ativo', f.ativo) end as familias
      from agenda_coletas a
      join familias f on f.id = a.familia_id
    `;
  }

  return `select * from ${table}`;
}

function columnRef(table, field) {
  const refs = {
    usuarios: "usuarios",
    familias: "familias",
    concorrentes: "concorrentes",
    produtos: "p",
    mapeamentos_sku: "m",
    historico_precos: "h",
    execucoes_robo: "execucoes_robo",
    agenda_coletas: "a",
    app_config: "app_config",
  };

  if (field === "produtos.ativo") return "p.ativo";
  if (field === "produtos.familia_id") return "p.familia_id";
  if (field === "concorrentes.ativo") return "c.ativo";
  return `${refs[table]}.${field}`;
}

function mutationColumnRef(table, field) {
  const directField = String(field).includes(".") ? String(field).split(".").at(-1) : field;
  return `${table}.${directField}`;
}

function orderRef(table, field) {
  return columnRef(table, field);
}

function buildWhere(table, filters = [], values, refResolver = columnRef) {
  const clauses = [];

  for (const filter of filters) {
    const ref = refResolver(table, filter.field);
    if (filter.op === "eq") {
      values.push(filter.value);
      clauses.push(`${ref} = $${values.length}`);
    } else if (filter.op === "neq") {
      values.push(filter.value);
      clauses.push(`${ref} <> $${values.length}`);
    } else if (filter.op === "in") {
      values.push(filter.value);
      clauses.push(`${ref} = any($${values.length})`);
    } else if (filter.op === "gte") {
      values.push(filter.value);
      clauses.push(`${ref} >= $${values.length}`);
    } else if (filter.op === "lte") {
      values.push(filter.value);
      clauses.push(`${ref} <= $${values.length}`);
    }
  }

  return clauses.length ? ` where ${clauses.join(" and ")}` : "";
}

export async function runQuery(body) {
  const table = resolveTable(body.table);
  const action = body.action ?? "select";

  if (action === "select") {
    const values = [];
    let sql = baseSelect(table);
    sql += buildWhere(table, body.filters, values);

    if (body.order?.field) {
      sql += ` order by ${orderRef(table, body.order.field)} ${body.order.ascending === false ? "desc" : "asc"}`;
      if (body.order.nullsFirst === false) sql += " nulls last";
    }

    if (body.limit) {
      values.push(Number(body.limit));
      sql += ` limit $${values.length}`;
    }

    const { rows } = await query(sql, values);
    const data = normalize(rows);
    return body.single || body.maybeSingle ? (data[0] ?? null) : data;
  }

  if (action === "insert") {
    const payloads = Array.isArray(body.payload) ? body.payload : [body.payload];
    const inserted = [];
    const columns = allowedColumns[table] ?? [];

    for (const payload of payloads) {
      const entries = Object.entries(payload ?? {}).filter(([key]) => columns.includes(key));
      const names = entries.map(([key]) => key);
      const values = entries.map(([, value]) => value);
      const placeholders = values.map((_, index) => `$${index + 1}`);
      const sql = `
        insert into ${table} (${names.join(",")})
        values (${placeholders.join(",")})
        returning *
      `;
      const { rows } = await query(sql, values);
      inserted.push(rows[0]);
    }

    if (body.returning) {
      const ids = inserted.map((row) => row.id);
      return runQuery({
        table,
        action: "select",
        filters: [{ op: "in", field: "id", value: ids }],
        single: body.single,
      });
    }
    return body.single ? normalize(inserted[0]) : normalize(inserted);
  }

  if (action === "update") {
    const columns = allowedColumns[table] ?? [];
    const entries = Object.entries(body.payload ?? {}).filter(([key]) => columns.includes(key));
    const values = entries.map(([, value]) => value);
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`);
    let sql = `update ${table} set ${assignments.join(",")}`;
    sql += buildWhere(table, body.filters, values, mutationColumnRef);
    sql += " returning *";
    const { rows } = await query(sql, values);

    if (body.returning) {
      const ids = rows.map((row) => row.id);
      return runQuery({
        table,
        action: "select",
        filters: [{ op: "in", field: "id", value: ids }],
        single: body.single,
      });
    }
    return body.single ? normalize(rows[0] ?? null) : normalize(rows);
  }

  if (action === "delete") {
    if (!body.filters?.length) {
      throw new Error("Delete sem filtro nao e permitido.");
    }

    const values = [];
    let sql = `delete from ${table}`;
    sql += buildWhere(table, body.filters, values, mutationColumnRef);
    sql += " returning id";
    const { rows } = await query(sql, values);
    return rows;
  }

  throw new Error(`Acao nao permitida: ${action}`);
}
