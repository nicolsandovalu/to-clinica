import {
  AVISO_DICTADO_NO_DISPONIBLE,
  ControladorDictado,
  EstadoDictado,
  MotorDictado,
  OPCIONES_DICTADO,
  OyentesMotorDictado,
  anexarTexto,
} from '../src/modules/registro/dictado';
import {
  cargarContextoRegistro,
  editarSesionHistorica,
  guardarSesion,
  listarHistorial,
} from '../src/modules/registro/servicio';
import { crearRepositorioMemoria, crearRepositorioSQLitePrueba } from './ayudas/entorno';

const CAMPOS = {
  observaciones: 'Buena disposición',
  objetivos_cumplidos: 'Agarre trípode',
  retroalimentacion_familia: 'Pide tareas para la casa',
};

async function prepararCita(repo: ReturnType<typeof crearRepositorioMemoria>, fecha = '2026-03-02T15:00:00.000Z') {
  const paciente = await repo.crearPaciente({
    propietaria_id: '1',
    nombre: 'Paciente Uno',
    antecedentes: 'Prematuro',
  });
  const cita = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: fecha });
  return { paciente, cita };
}

describe.each([
  ['memoria', async () => crearRepositorioMemoria()],
  [
    'SQLite',
    async () => {
      const { repositorio } = crearRepositorioSQLitePrueba();
      await repositorio.inicializar();
      return repositorio;
    },
  ],
])('guardado de sesión (%s)', (_nombre, fabrica) => {
  it('crea el registro, lo encola en cola_sync y queda pendiente', async () => {
    const repo = (await fabrica()) as ReturnType<typeof crearRepositorioMemoria>;
    const { cita } = await prepararCita(repo);
    const colaAntes = (await repo.listarColaSync()).length;

    const registro = await guardarSesion(repo, cita.id, CAMPOS);

    expect(registro).toMatchObject({ cita_id: cita.id, ...CAMPOS, archivado: false, estado_sync: 'pendiente' });
    const cola = await repo.listarColaSync();
    expect(cola).toHaveLength(colaAntes + 1);
    const op = cola.find((o) => o.entidad === 'registro_sesion');
    expect(op).toMatchObject({ registro_id: registro.id, operacion: 'crear' });
  });

  it('relación 1 a 1: guardar de nuevo la misma cita edita el registro existente', async () => {
    const repo = (await fabrica()) as ReturnType<typeof crearRepositorioMemoria>;
    const { cita } = await prepararCita(repo);

    const primero = await guardarSesion(repo, cita.id, CAMPOS);
    const segundo = await guardarSesion(repo, cita.id, { ...CAMPOS, observaciones: 'Cambió' });

    expect(segundo.id).toBe(primero.id);
    expect(segundo.observaciones).toBe('Cambió');
    expect(segundo.creado_en).toBe(primero.creado_en);
    expect(segundo.modificado_en > primero.modificado_en).toBe(true);
    const ops = (await repo.listarColaSync()).filter((o) => o.entidad === 'registro_sesion');
    expect(ops.map((o) => o.operacion)).toContain('actualizar');
  });

  it('rechaza citas inexistentes y no crea registros duplicados por cita', async () => {
    const repo = (await fabrica()) as ReturnType<typeof crearRepositorioMemoria>;
    const { cita } = await prepararCita(repo);
    await expect(guardarSesion(repo, 'no-existe', CAMPOS)).rejects.toMatchObject({
      name: 'ErrorRepositorio',
    });
    await expect(repo.crearRegistroSesion({ cita_id: cita.id })).resolves.toBeDefined();
    await expect(repo.crearRegistroSesion({ cita_id: cita.id })).rejects.toMatchObject({
      codigo: 'duplicado',
    });
  });

  it('cargarContextoRegistro devuelve paciente, cita y el registro previo', async () => {
    const repo = (await fabrica()) as ReturnType<typeof crearRepositorioMemoria>;
    const { paciente, cita } = await prepararCita(repo);
    expect((await cargarContextoRegistro(repo, cita.id))?.registro).toBeNull();
    const registro = await guardarSesion(repo, cita.id, CAMPOS);
    const ctx = await cargarContextoRegistro(repo, cita.id);
    expect(ctx?.paciente.id).toBe(paciente.id);
    expect(ctx?.registro?.id).toBe(registro.id);
    expect(await cargarContextoRegistro(repo, 'no-existe')).toBeNull();
  });
});

describe('historial y edición histórica', () => {
  it('lista solo sesiones activas, de la más reciente a la más antigua por creado_en', async () => {
    const repo = crearRepositorioMemoria();
    const { paciente, cita: c1 } = await prepararCita(repo, '2026-03-02T15:00:00.000Z');
    const c2 = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-09T15:00:00.000Z' });
    const c3 = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-16T15:00:00.000Z' });
    const r1 = await guardarSesion(repo, c1.id, CAMPOS);
    const r2 = await guardarSesion(repo, c2.id, CAMPOS);
    const r3 = await guardarSesion(repo, c3.id, CAMPOS);
    await repo.archivarRegistroSesion(r2.id);

    const historial = await listarHistorial(repo, paciente.id);

    expect(historial.map((e) => e.registro.id)).toEqual([r3.id, r1.id]);
    expect(historial.every((e) => e.estado_sync === 'pendiente')).toBe(true);
  });

  it('refleja el estado sincronizado tras confirmar la operación', async () => {
    const repo = crearRepositorioMemoria();
    const { paciente, cita } = await prepararCita(repo);
    await guardarSesion(repo, cita.id, CAMPOS);
    for (const op of await repo.listarColaSync()) await repo.confirmarOperacionSync(op.op_id);
    const [entrada] = await listarHistorial(repo, paciente.id);
    expect(entrada?.estado_sync).toBe('sincronizado');
  });

  it('editar actualiza modificado_en, conserva creado_en y encola la operación', async () => {
    const repo = crearRepositorioMemoria();
    const { paciente, cita } = await prepararCita(repo);
    const original = await guardarSesion(repo, cita.id, CAMPOS);
    for (const op of await repo.listarColaSync()) await repo.confirmarOperacionSync(op.op_id);
    expect((await listarHistorial(repo, paciente.id))[0]?.estado_sync).toBe('sincronizado');

    const editado = await editarSesionHistorica(repo, original.id, {
      ...CAMPOS,
      objetivos_cumplidos: 'Corregido',
    });

    expect(editado.objetivos_cumplidos).toBe('Corregido');
    expect(editado.creado_en).toBe(original.creado_en);
    expect(editado.modificado_en > original.modificado_en).toBe(true);
    expect(editado.estado_sync).toBe('pendiente');
    const cola = await repo.listarColaSync();
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({ registro_id: original.id, operacion: 'actualizar' });
    expect((await listarHistorial(repo, paciente.id))[0]?.estado_sync).toBe('pendiente');
  });
});

describe('anexarTexto', () => {
  it('anexa sin borrar lo escrito ni duplicar espacios', () => {
    expect(anexarTexto('', 'hola')).toBe('hola');
    expect(anexarTexto('   ', ' hola ')).toBe('hola');
    expect(anexarTexto('Texto previo', ' dictado ')).toBe('Texto previo dictado');
    expect(anexarTexto('Texto previo ', 'dictado')).toBe('Texto previo dictado');
    expect(anexarTexto('Texto', '   ')).toBe('Texto');
  });
});

describe('dictado on-device y fallback sin voz', () => {
  interface MotorFalso extends MotorDictado {
    oyentes: OyentesMotorDictado | null;
    iniciados: unknown[];
    detenciones: number;
  }

  function crearMotor(opciones: { onDevice?: boolean; permisos?: boolean } = {}): MotorFalso {
    const motor: MotorFalso = {
      oyentes: null,
      iniciados: [],
      detenciones: 0,
      soportaOnDevice: () => opciones.onDevice ?? true,
      pedirPermisos: async () => opciones.permisos ?? true,
      iniciar: (o) => {
        motor.iniciados.push(o);
      },
      detener: () => {
        motor.detenciones += 1;
      },
      suscribir: (oyentes) => {
        motor.oyentes = oyentes;
        return () => {
          motor.oyentes = null;
        };
      },
    };
    return motor;
  }

  function crearControlador(motor: MotorDictado | null) {
    const textos: [string, string][] = [];
    const estados: EstadoDictado[] = [];
    const controlador = new ControladorDictado(motor, {
      alTexto: (campo, texto) => textos.push([campo, texto]),
      alCambiar: (e) => estados.push(e),
    });
    return { controlador, textos, estados };
  }

  it('inicia en español, on-device, sin persistir audio', async () => {
    const motor = crearMotor();
    const { controlador } = crearControlador(motor);
    await controlador.iniciar('observaciones');
    expect(motor.iniciados).toEqual([OPCIONES_DICTADO]);
    expect(OPCIONES_DICTADO).toMatchObject({
      lang: expect.stringMatching(/^es/),
      requiresOnDeviceRecognition: true,
      recordingOptions: { persist: false },
    });
    expect(controlador.obtenerEstado()).toMatchObject({ disponible: true, escuchando: true });
  });

  it('entrega la transcripción final al campo activo y se detiene', async () => {
    const motor = crearMotor();
    const { controlador, textos } = crearControlador(motor);
    await controlador.iniciar('objetivos_cumplidos');
    motor.oyentes?.resultado('lanzó la pelota');
    expect(textos).toEqual([['objetivos_cumplidos', 'lanzó la pelota']]);
    controlador.detener();
    expect(motor.detenciones).toBe(1);
    expect(controlador.obtenerEstado().escuchando).toBe(false);
    expect(motor.oyentes).toBeNull();
  });

  it('iniciar en otro campo detiene el dictado anterior', async () => {
    const motor = crearMotor();
    const { controlador } = crearControlador(motor);
    await controlador.iniciar('observaciones');
    await controlador.iniciar('objetivos_cumplidos');
    expect(motor.detenciones).toBe(1);
    expect(controlador.campo).toBe('objetivos_cumplidos');
  });

  it('sin permiso: disponible=false, aviso y nunca inicia el reconocimiento', async () => {
    const motor = crearMotor({ permisos: false });
    const { controlador } = crearControlador(motor);
    await controlador.iniciar('observaciones');
    expect(motor.iniciados).toHaveLength(0);
    expect(controlador.obtenerEstado()).toEqual({
      disponible: false,
      escuchando: false,
      aviso: AVISO_DICTADO_NO_DISPONIBLE,
    });
    expect(AVISO_DICTADO_NO_DISPONIBLE).toBe('Dictado por voz no disponible');
  });

  it('sin motor on-device: no pide permisos ni escucha, y marca no disponible', async () => {
    const motor = crearMotor({ onDevice: false });
    const pedir = jest.spyOn(motor, 'pedirPermisos');
    const { controlador } = crearControlador(motor);
    await controlador.iniciar('observaciones');
    expect(pedir).not.toHaveBeenCalled();
    expect(motor.iniciados).toHaveLength(0);
    expect(controlador.obtenerEstado().disponible).toBe(false);
  });

  it('sin módulo nativo: no disponible desde el inicio y el teclado sigue funcionando', async () => {
    const { controlador, estados } = crearControlador(null);
    expect(controlador.obtenerEstado()).toMatchObject({
      disponible: false,
      aviso: AVISO_DICTADO_NO_DISPONIBLE,
    });
    expect(estados).toHaveLength(1);
    await expect(controlador.iniciar('observaciones')).resolves.toBeUndefined();
    controlador.detener();
  });

  it('si el motor falla al iniciar, queda no disponible sin lanzar', async () => {
    const motor = crearMotor();
    motor.iniciar = () => {
      throw new Error('fallo nativo');
    };
    const { controlador } = crearControlador(motor);
    await expect(controlador.iniciar('observaciones')).resolves.toBeUndefined();
    expect(controlador.obtenerEstado()).toMatchObject({ disponible: false, escuchando: false });
  });

  it('un error del motor termina la escucha sin desactivar el dictado', async () => {
    const motor = crearMotor();
    const { controlador } = crearControlador(motor);
    await controlador.iniciar('observaciones');
    motor.oyentes?.error('no-speech');
    expect(controlador.obtenerEstado()).toMatchObject({ disponible: true, escuchando: false });
  });

  it('guardar funciona aunque el dictado no esté disponible (solo teclado)', async () => {
    const repo = crearRepositorioMemoria();
    const { cita } = await prepararCita(repo);
    const { controlador } = crearControlador(crearMotor({ permisos: false }));
    await controlador.iniciar('observaciones');
    const texto = anexarTexto('Escrito a mano', 'y más');
    const registro = await guardarSesion(repo, cita.id, { ...CAMPOS, observaciones: texto });
    expect(registro.observaciones).toBe('Escrito a mano y más');
  });
});
