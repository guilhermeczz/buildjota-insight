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
  return allowedConcorrenteNames.includes(normalizeConcorrenteName(concorrenteNome));
}

export function credentialsFor(concorrenteNome) {
  const keys = concorrenteEnv[normalizeConcorrenteName(concorrenteNome)];
  if (!keys) return null;

  const login = process.env[keys.login];
  const password = process.env[keys.password];

  if (!login || !password) return null;

  return { login, password };
}
