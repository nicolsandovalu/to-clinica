import { ErrorApi, crearClienteApi } from '../src/modules/acceso/api';

function respuesta(status: number, cuerpo?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (cuerpo === undefined) throw new Error('sin cuerpo');
      return cuerpo;
    },
  } as Response;
}

function crear(respuestaServidor: Response | Error) {
  const fetchFalso = jest.fn(async (_url: string, _init: RequestInit) => {
    if (respuestaServidor instanceof Error) throw respuestaServidor;
    return respuestaServidor;
  });
  const api = crearClienteApi({ urlBase: 'https://api.ejemplo.cl/', fetch: fetchFalso });
  return { api, fetchFalso };
}

describe('cliente de API', () => {
  it('exige HTTPS salvo que se permita HTTP explícitamente (desarrollo)', () => {
    expect(() => crearClienteApi({ urlBase: 'http://api.ejemplo.cl' })).toThrow('HTTPS');
    expect(() => crearClienteApi({ urlBase: '' })).toThrow('HTTPS');
    expect(() => crearClienteApi({ urlBase: 'ftp://x', permitirHttp: true })).toThrow('HTTPS');
    expect(() => crearClienteApi({ urlBase: 'http://10.0.2.2:8000', permitirHttp: true })).not.toThrow();
  });

  it('login envía las credenciales por POST y normaliza la respuesta', async () => {
    const { api, fetchFalso } = crear(respuesta(200, { token: 'abc', usuaria: { id: 7, email: 'a@b.cl' } }));

    const resultado = await api.login('a@b.cl', 'Clave#1234');

    expect(resultado).toEqual({ token: 'abc', sesion: { usuaria_id: '7', email: 'a@b.cl' } });
    const [url, init] = fetchFalso.mock.calls[0] ?? [];
    expect(url).toBe('https://api.ejemplo.cl/api/cuentas/login/');
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.cl', password: 'Clave#1234' }),
    });
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it.each([
    [400, 'credenciales'],
    [401, 'credenciales'],
    [429, 'limite'],
    [500, 'servidor'],
  ])('login con HTTP %i produce el error "%s"', async (status, tipo) => {
    const { api } = crear(respuesta(status, { detail: 'detalle interno del servidor' }));
    const error = await api.login('a@b.cl', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ tipo, codigoHttp: status });
    expect((error as Error).message).not.toContain('detalle interno');
  });

  it('login rechaza respuestas mal formadas', async () => {
    await expect(crear(respuesta(200, { token: '' })).api.login('a', 'b')).rejects.toMatchObject({
      tipo: 'servidor',
    });
    await expect(crear(respuesta(200, { token: 'abc' })).api.login('a', 'b')).rejects.toMatchObject({
      tipo: 'servidor',
    });
    await expect(crear(respuesta(200)).api.login('a', 'b')).rejects.toMatchObject({ tipo: 'servidor' });
  });

  it('los fallos de red se informan como "red"', async () => {
    const { api } = crear(new TypeError('Network request failed'));
    await expect(api.login('a', 'b')).rejects.toMatchObject({ tipo: 'red' });
    await expect(api.logout('t')).rejects.toMatchObject({ tipo: 'red' });
  });

  it('logout y restauración autentican solo con la cabecera Authorization: Token', async () => {
    const salida = crear(respuesta(204));
    await salida.api.logout('abc');
    const [urlLogout, initLogout] = salida.fetchFalso.mock.calls[0] ?? [];
    expect(urlLogout).toBe('https://api.ejemplo.cl/api/cuentas/logout/');
    expect(initLogout).toMatchObject({ method: 'POST', headers: { Authorization: 'Token abc' } });
    expect(urlLogout).not.toContain('abc');

    const instantanea = { apoderados: [], pacientes: [], citas: [], registros_sesion: [] };
    const restauracion = crear(respuesta(200, instantanea));
    expect(await restauracion.api.descargarInstantanea('abc')).toEqual(instantanea);
    const [urlRestauracion, initRestauracion] = restauracion.fetchFalso.mock.calls[0] ?? [];
    expect(urlRestauracion).toBe('https://api.ejemplo.cl/api/clinica/restaurar/');
    expect(initRestauracion).toMatchObject({ method: 'GET', headers: { Authorization: 'Token abc' } });
  });

  it('un token rechazado se informa como "no_autorizado"', async () => {
    await expect(crear(respuesta(401)).api.logout('t')).rejects.toMatchObject({ tipo: 'no_autorizado' });
    await expect(crear(respuesta(401)).api.descargarInstantanea('t')).rejects.toMatchObject({
      tipo: 'no_autorizado',
    });
    await expect(crear(respuesta(503)).api.descargarInstantanea('t')).rejects.toMatchObject({
      tipo: 'servidor',
    });
  });
});
