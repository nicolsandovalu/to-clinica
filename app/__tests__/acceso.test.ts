import { CLAVES_ALMACEN } from '../src/data/almacenSeguro';
import { ErrorApi, MENSAJE_LOGIN_GENERICO } from '../src/modules/acceso/api';
import { MENSAJES_ACCESO } from '../src/modules/acceso/gestorAcceso';
import { VERSION_POLITICA } from '../src/modules/acceso/politica';
import {
  EMAIL,
  EntornoAcceso,
  INSTANTANEA_CON_PACIENTE,
  PASSWORD,
  TOKEN,
  crearEntornoAcceso,
  gestorConSesion,
} from './ayudas/acceso';

let entorno: EntornoAcceso;

beforeEach(() => {
  entorno = crearEntornoAcceso();
});

afterEach(() => {
  entorno.destruir();
});

describe('bloqueo por Política de Privacidad', () => {
  it('en el primer inicio la app queda detenida en la política', async () => {
    const gestor = entorno.crearGestor();
    expect(gestor.obtenerEstado().fase).toBe('cargando');
    await gestor.iniciar();
    expect(gestor.obtenerEstado().fase).toBe('politica_pendiente');
  });

  it('sin aceptar no se puede iniciar sesión, desbloquear ni restaurar', async () => {
    const gestor = entorno.crearGestor();
    await gestor.iniciar();

    await gestor.iniciarSesion(EMAIL, PASSWORD);
    await gestor.desbloquear();
    await gestor.reintentarRestauracion();

    expect(gestor.obtenerEstado().fase).toBe('politica_pendiente');
    expect(gestor.obtenerEstado().sesion).toBeNull();
    expect(entorno.api.llamadas).toEqual([]);
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.token)).toBeNull();
  });

  it('la política sigue bloqueando aunque exista una sesión guardada', async () => {
    await entorno.almacenSeguro.guardar(CLAVES_ALMACEN.token, TOKEN);
    await entorno.almacenSeguro.guardar(
      CLAVES_ALMACEN.usuaria,
      JSON.stringify({ usuaria_id: '7', email: EMAIL }),
    );
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    expect(gestor.obtenerEstado().fase).toBe('politica_pendiente');

    await gestor.aceptarPolitica();
    // Con sesión previa se exige además el desbloqueo local.
    expect(gestor.obtenerEstado().fase).toBe('bloqueada');
    expect((await entorno.repositorio.obtenerAceptacionPolitica(VERSION_POLITICA))?.usuaria_id).toBe('7');
  });

  it('al aceptar registra versión y fecha y encola su sincronización', async () => {
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    await gestor.aceptarPolitica();

    expect(gestor.obtenerEstado().fase).toBe('sin_sesion');
    const aceptacion = await entorno.repositorio.obtenerAceptacionPolitica(VERSION_POLITICA);
    expect(aceptacion).toMatchObject({ version: VERSION_POLITICA, estado_sync: 'pendiente' });
    expect(Number.isNaN(Date.parse(aceptacion?.aceptada_en ?? ''))).toBe(false);
    expect(await entorno.repositorio.listarColaSync()).toMatchObject([
      { entidad: 'aceptacion_politica', operacion: 'crear', registro_id: aceptacion?.id },
    ]);
  });

  it('no vuelve a pedirla en los inicios siguientes', async () => {
    const primero = entorno.crearGestor();
    await primero.iniciar();
    await primero.aceptarPolitica();

    const segundo = entorno.crearGestor();
    await segundo.iniciar();
    expect(segundo.obtenerEstado().fase).toBe('sin_sesion');
    expect(await entorno.repositorio.listarColaSync()).toHaveLength(1);
  });

  it('si no se puede guardar la aceptación, la app sigue bloqueada', async () => {
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    jest.spyOn(entorno.repositorio, 'registrarAceptacionPolitica').mockRejectedValueOnce(new Error('disco'));

    await gestor.aceptarPolitica();

    expect(gestor.obtenerEstado()).toMatchObject({
      fase: 'politica_pendiente',
      error: MENSAJES_ACCESO.politica,
      ocupada: false,
    });
  });

  it('si el almacenamiento cifrado no abre, no se avanza a ninguna pantalla con datos', async () => {
    jest.spyOn(entorno.repositorio, 'inicializar').mockRejectedValueOnce(new Error('sin cifrado'));
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    expect(gestor.obtenerEstado().fase).toBe('error_inicio');

    await gestor.iniciar(); // reintento
    expect(gestor.obtenerEstado().fase).toBe('politica_pendiente');
  });
});

describe('inicio de sesión', () => {
  async function gestorEnLogin() {
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    await gestor.aceptarPolitica();
    return gestor;
  }

  it('guarda el token en el almacén seguro y abre la app', async () => {
    await entorno.repositorio.crearPaciente({ propietaria_id: '7', nombre: 'Ya existía' });
    const gestor = await gestorEnLogin();
    await gestor.iniciarSesion(`  ${EMAIL} `, PASSWORD);

    expect(gestor.obtenerEstado()).toMatchObject({
      fase: 'desbloqueada',
      sesion: { usuaria_id: '7', email: EMAIL },
      error: null,
      ocupada: false,
    });
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.token)).toBe(TOKEN);
    // Con datos locales no se restaura.
    expect(entorno.api.llamadas).toEqual(['login']);
  });

  it.each([
    ['credenciales incorrectas', new ErrorApi('credenciales', 400), MENSAJE_LOGIN_GENERICO],
    ['límite de intentos', new ErrorApi('limite', 429), MENSAJES_ACCESO.limite],
    ['sin conexión', new ErrorApi('red'), MENSAJES_ACCESO.red],
    ['error del servidor', new ErrorApi('servidor', 500), MENSAJES_ACCESO.servidor],
  ])('con %s muestra un mensaje y no guarda nada', async (_caso, error, mensaje) => {
    const gestor = await gestorEnLogin();
    entorno.api.errorLogin = error;
    await gestor.iniciarSesion(EMAIL, PASSWORD);

    expect(gestor.obtenerEstado()).toMatchObject({ fase: 'sin_sesion', sesion: null, error: mensaje });
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.token)).toBeNull();
  });

  it('el mensaje de credenciales es genérico: no distingue correo de contraseña', async () => {
    const gestor = await gestorEnLogin();
    await gestor.iniciarSesion('otro@ejemplo.cl', PASSWORD);
    const correoMalo = gestor.obtenerEstado().error;
    await gestor.iniciarSesion(EMAIL, 'incorrecta');
    expect(gestor.obtenerEstado().error).toBe(correoMalo);
    expect(correoMalo).toBe('Correo o contraseña incorrectos.');
  });

  it('no llama al servidor con campos vacíos', async () => {
    const gestor = await gestorEnLogin();
    await gestor.iniciarSesion('', '');
    expect(gestor.obtenerEstado().error).toBe(MENSAJES_ACCESO.camposVacios);
    expect(entorno.api.llamadas).toEqual([]);
  });

  describe('dispositivo nuevo (repositorio vacío)', () => {
    it('restaura todo desde el servidor antes de abrir la Agenda', async () => {
      entorno.api.instantanea = INSTANTANEA_CON_PACIENTE;
      const gestor = await gestorEnLogin();
      const fases: string[] = [];
      gestor.suscribir(() => fases.push(gestor.obtenerEstado().fase));

      await gestor.iniciarSesion(EMAIL, PASSWORD);

      expect(entorno.api.llamadas).toEqual(['login', 'restauracion']);
      expect(fases.indexOf('restaurando')).toBeGreaterThanOrEqual(0);
      expect(fases.indexOf('restaurando')).toBeLessThan(fases.indexOf('desbloqueada'));
      const pacientes = await entorno.repositorio.listarPacientes();
      expect(pacientes).toMatchObject([{ nombre: 'Paciente del servidor', estado_sync: 'sincronizado' }]);
      expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.restauracionPendiente)).toBeNull();
      // Evento de restauración solo con metadatos.
      expect(await entorno.repositorio.listarEventosSync()).toMatchObject([{ tipo: 'restauracion' }]);
      expect(JSON.stringify(await entorno.repositorio.listarEventosSync())).not.toContain('Paciente');
    });

    it('si la restauración falla no abre la Agenda, y permite reintentar', async () => {
      entorno.api.instantanea = INSTANTANEA_CON_PACIENTE;
      entorno.api.errorRestauracion = new ErrorApi('red');
      const gestor = await gestorEnLogin();
      await gestor.iniciarSesion(EMAIL, PASSWORD);

      expect(gestor.obtenerEstado()).toMatchObject({
        fase: 'restauracion_fallida',
        error: MENSAJES_ACCESO.restauracion,
      });

      entorno.api.errorRestauracion = null;
      await gestor.reintentarRestauracion();
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
      expect(await entorno.repositorio.listarPacientes()).toHaveLength(1);
    });

    it('una restauración pendiente se retoma al reabrir la app, y luego exige desbloqueo', async () => {
      entorno.api.instantanea = INSTANTANEA_CON_PACIENTE;
      entorno.api.errorRestauracion = new ErrorApi('red');
      await (await gestorEnLogin()).iniciarSesion(EMAIL, PASSWORD);

      entorno.api.errorRestauracion = null;
      const reabierto = entorno.crearGestor();
      await reabierto.iniciar();

      expect(reabierto.obtenerEstado().fase).toBe('bloqueada');
      expect(await entorno.repositorio.listarPacientes()).toHaveLength(1);
    });

    it('una instantánea inválida no deja datos parciales', async () => {
      entorno.api.instantanea = { ...INSTANTANEA_CON_PACIENTE, citas: [{ id: 'x' }] as never };
      const gestor = await gestorEnLogin();
      await gestor.iniciarSesion(EMAIL, PASSWORD);

      expect(gestor.obtenerEstado().fase).toBe('restauracion_fallida');
      expect(await entorno.repositorio.estaVacio()).toBe(true);
    });

    it('si el servidor rechaza el token durante la restauración, vuelve al inicio de sesión', async () => {
      entorno.api.errorRestauracion = new ErrorApi('no_autorizado', 401);
      const gestor = await gestorEnLogin();
      await gestor.iniciarSesion(EMAIL, PASSWORD);

      expect(gestor.obtenerEstado()).toMatchObject({ fase: 'sin_sesion', sesion: null });
      expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.token)).toBeNull();
    });
  });
});

describe('bloqueo local', () => {
  it('al abrir la app con sesión iniciada parte bloqueada', async () => {
    await gestorConSesion(entorno);
    const reabierto = entorno.crearGestor();
    await reabierto.iniciar();
    expect(reabierto.obtenerEstado().fase).toBe('bloqueada');
    expect(entorno.autenticador.intentos).toBe(0);
  });

  it('se desbloquea solo con una autenticación local exitosa', async () => {
    await gestorConSesion(entorno);
    const gestor = entorno.crearGestor();
    await gestor.iniciar();

    entorno.autenticador.resultado = { ok: false, motivo: 'fallida' };
    await gestor.desbloquear();
    expect(gestor.obtenerEstado()).toMatchObject({
      fase: 'bloqueada',
      error: MENSAJES_ACCESO.desbloqueoFallido,
    });

    entorno.autenticador.resultado = { ok: false, motivo: 'cancelada' };
    await gestor.desbloquear();
    expect(gestor.obtenerEstado().fase).toBe('bloqueada');

    entorno.autenticador.resultado = { ok: true };
    await gestor.desbloquear();
    expect(gestor.obtenerEstado()).toMatchObject({ fase: 'desbloqueada', error: null });
  });

  it('sin bloqueo de pantalla en el teléfono, niega el acceso', async () => {
    await gestorConSesion(entorno);
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    entorno.autenticador.resultado = { ok: false, motivo: 'sin_proteccion' };
    await gestor.desbloquear();
    expect(gestor.obtenerEstado()).toMatchObject({
      fase: 'bloqueada',
      error: MENSAJES_ACCESO.sinProteccion,
    });
  });

  it('si la autenticación lanza un error, queda bloqueada y utilizable', async () => {
    await gestorConSesion(entorno);
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    jest.spyOn(entorno.autenticador, 'autenticar').mockRejectedValueOnce(new Error('hardware'));

    await gestor.desbloquear();
    expect(gestor.obtenerEstado()).toMatchObject({
      fase: 'bloqueada',
      ocupada: false,
      error: MENSAJES_ACCESO.inesperado,
    });
  });

  describe('inactividad y segundo plano', () => {
    const MINUTO = 60_000;

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** Avanza el reloj inyectado y los temporizadores a la vez. */
    function avanzar(ms: number) {
      entorno.reloj.ahora += ms;
      jest.advanceTimersByTime(ms);
    }

    it('bloquea tras 5 minutos sin actividad', async () => {
      const gestor = await gestorConSesion(entorno);
      avanzar(5 * MINUTO - 1);
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
      avanzar(1);
      expect(gestor.obtenerEstado().fase).toBe('bloqueada');
    });

    it('la actividad de la usuaria reinicia el plazo', async () => {
      const gestor = await gestorConSesion(entorno);
      avanzar(4 * MINUTO);
      gestor.registrarActividad();
      avanzar(4 * MINUTO);
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
      avanzar(MINUTO);
      expect(gestor.obtenerEstado().fase).toBe('bloqueada');
    });

    it('bloquea tras 60 segundos en segundo plano', async () => {
      const gestor = await gestorConSesion(entorno);
      gestor.alCambiarEstadoApp('background');
      avanzar(59_999);
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
      avanzar(1);
      expect(gestor.obtenerEstado().fase).toBe('bloqueada');
    });

    it('no bloquea si vuelve antes de 60 segundos, y el plazo se reinicia', async () => {
      const gestor = await gestorConSesion(entorno);
      gestor.alCambiarEstadoApp('background');
      avanzar(30_000);
      gestor.alCambiarEstadoApp('active');
      gestor.alCambiarEstadoApp('background');
      avanzar(45_000);
      gestor.alCambiarEstadoApp('active');
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
    });

    it('bloquea al volver aunque el sistema haya suspendido los temporizadores', async () => {
      const gestor = await gestorConSesion(entorno);
      gestor.alCambiarEstadoApp('background');
      entorno.reloj.ahora += 61_000; // el tiempo pasa pero ningún temporizador se ejecuta
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
      gestor.alCambiarEstadoApp('active');
      expect(gestor.obtenerEstado().fase).toBe('bloqueada');
    });

    it('un toque tardío no revive una sesión cuyo plazo ya venció', async () => {
      const gestor = await gestorConSesion(entorno);
      entorno.reloj.ahora += 5 * MINUTO; // temporizador suspendido
      gestor.registrarActividad();
      expect(gestor.obtenerEstado().fase).toBe('bloqueada');
    });

    it('el estado "inactive" (p. ej. el diálogo biométrico) no cuenta como segundo plano', async () => {
      const gestor = await gestorConSesion(entorno);
      gestor.alCambiarEstadoApp('inactive');
      avanzar(2 * MINUTO);
      gestor.alCambiarEstadoApp('active');
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
    });

    it('tras desbloquear de nuevo, los plazos vuelven a contar desde cero', async () => {
      const gestor = await gestorConSesion(entorno);
      avanzar(5 * MINUTO);
      expect(gestor.obtenerEstado().fase).toBe('bloqueada');

      await gestor.desbloquear();
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
      avanzar(5 * MINUTO - 1);
      expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
      avanzar(1);
      expect(gestor.obtenerEstado().fase).toBe('bloqueada');
    });

    it('sin sesión los temporizadores no cambian de fase', async () => {
      const gestor = await gestorConSesion(entorno);
      await gestor.cerrarSesion();
      gestor.registrarActividad();
      avanzar(10 * MINUTO);
      expect(gestor.obtenerEstado().fase).toBe('sin_sesion');
    });
  });
});

describe('cierre de sesión', () => {
  it('revoca el token en el servidor y lo elimina del teléfono', async () => {
    const gestor = await gestorConSesion(entorno);
    await gestor.cerrarSesion();

    expect(entorno.api.tokensRevocados).toEqual([TOKEN]);
    expect(gestor.obtenerEstado()).toMatchObject({ fase: 'sin_sesion', sesion: null });
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.token)).toBeNull();
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.usuaria)).toBeNull();
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.revocacionesPendientes)).toBeNull();
  });

  it('sin conexión, elimina el token local y encola la revocación', async () => {
    const gestor = await gestorConSesion(entorno);
    entorno.api.errorLogout = new ErrorApi('red');
    await gestor.cerrarSesion();

    expect(gestor.obtenerEstado().fase).toBe('sin_sesion');
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.token)).toBeNull();
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.revocacionesPendientes)).toBe(
      JSON.stringify([TOKEN]),
    );

    entorno.api.errorLogout = null;
    await gestor.reintentarRevocaciones();
    expect(entorno.api.tokensRevocados).toEqual([TOKEN]);
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.revocacionesPendientes)).toBeNull();
  });

  it('la revocación encolada se reintenta al volver a abrir la app', async () => {
    const gestor = await gestorConSesion(entorno);
    entorno.api.errorLogout = new ErrorApi('servidor', 503);
    await gestor.cerrarSesion();
    entorno.api.errorLogout = null;

    const reabierto = entorno.crearGestor();
    await reabierto.iniciar();
    await reabierto.reintentarRevocaciones();

    expect(entorno.api.tokensRevocados).toEqual([TOKEN]);
  });

  it('si el servidor ya no reconoce el token, no queda nada por revocar', async () => {
    const gestor = await gestorConSesion(entorno);
    entorno.api.errorLogout = new ErrorApi('no_autorizado', 401);
    await gestor.cerrarSesion();
    expect(await entorno.almacenSeguro.obtener(CLAVES_ALMACEN.revocacionesPendientes)).toBeNull();
  });

  it('se puede cerrar sesión desde la pantalla de bloqueo, y los datos locales se conservan', async () => {
    await gestorConSesion(entorno);
    await entorno.repositorio.crearPaciente({ propietaria_id: '7', nombre: 'Se conserva' });
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    expect(gestor.obtenerEstado().fase).toBe('bloqueada');

    await gestor.cerrarSesion();

    expect(gestor.obtenerEstado().fase).toBe('sin_sesion');
    expect(await entorno.repositorio.listarPacientes()).toHaveLength(1);
    // Volver a entrar con datos locales no dispara la restauración.
    await gestor.iniciarSesion(EMAIL, PASSWORD);
    expect(gestor.obtenerEstado().fase).toBe('desbloqueada');
    expect(entorno.api.llamadas.slice(-2)).toEqual(['logout', 'login']);
  });
});
