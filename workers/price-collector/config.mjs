export const concorrenteEnv = {
  "FERA ATACADO": {
    login: "FERA_ATACADO_LOGIN",
    password: "FERA_ATACADO_PASSWORD",
  },
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

export function credentialsFor(concorrenteNome) {
  const keys = concorrenteEnv[concorrenteNome?.trim()];
  if (!keys) return null;

  const login = process.env[keys.login];
  const password = process.env[keys.password];

  if (!login || !password) return null;

  return { login, password };
}
