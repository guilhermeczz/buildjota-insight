export const concorrenteEnv = {
  COFEMA: {
    login: "COFEMA_LOGIN",
    password: "COFEMA_PASSWORD",
  },
  CONSTRUJA: {
    login: "CONSTRUJA_LOGIN",
    password: "CONSTRUJA_PASSWORD",
  },
  MAREST: {
    login: "MAREST_LOGIN",
    password: "MAREST_PASSWORD",
  },
  MEGALESTE: {
    login: "MEGALESTE_LOGIN",
    password: "MEGALESTE_PASSWORD",
  },
};

export const allowedConcorrenteNames = Object.keys(concorrenteEnv);

export function normalizeConcorrenteName(concorrenteNome) {
  return String(concorrenteNome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function isAllowedConcorrente(concorrenteNome) {
  return Boolean(resolveConcorrenteKey(concorrenteNome));
}

export function resolveConcorrenteKey(concorrenteNome) {
  const normalized = normalizeConcorrenteName(concorrenteNome);
  if (concorrenteEnv[normalized]) return normalized;
  return allowedConcorrenteNames.find((name) => normalized.includes(name)) ?? null;
}

export function credentialsFor(concorrenteNome) {
  const keys = concorrenteEnv[resolveConcorrenteKey(concorrenteNome)];
  if (!keys) return null;

  const login = process.env[keys.login];
  const password = process.env[keys.password];

  if (!login || !password) return null;

  return { login, password };
}
