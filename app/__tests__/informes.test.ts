import {
  CATEGORIAS_EVOLUCION,
  DependenciasPdf,
  MENSAJES_RANGO,
  compilarBorrador,
  compilarBorradorDePaciente,
  construirHtml,
  editarCampo,
  editarItem,
  eliminarItem,
  escaparHtml,
  filtrarSesionesPorRango,
  formatearFecha,
  generarYCompartirPdf,
  validarRango,
} from '../src/modules/informes/pdf';
import { listarHistorial } from '../src/modules/registro/servicio';
import { crearRepositorioMemoria } from './ayudas/entorno';

/** Mediodía local del día indicado (evita cruces de día por zona horaria). */
function mediodia(anio: number, mes: number, dia: number): string {
  return new Date(anio, mes - 1, dia, 12, 0).toISOString();
}

async function escenario() {
  const repo = crearRepositorioMemoria();
  const paciente = await repo.crearPaciente({
    propietaria_id: '1',
    nombre: 'Ana <Pérez> & "Hijos"',
    fecha_nacimiento: '2019-05-04',
    antecedentes: 'Prematura',
    motivo_consulta: 'Integración sensorial',
  });
  const fechas = [mediodia(2026, 3, 20), mediodia(2026, 3, 5), mediodia(2026, 4, 2)];
  const textos = ['Segunda sesión', 'Primera sesión', 'Fuera de rango'];
  for (let i = 0; i < fechas.length; i += 1) {
    const cita = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: fechas[i] ?? '' });
    await repo.crearRegistroSesion({
      cita_id: cita.id,
      observaciones: textos[i],
      objetivos_cumplidos: i === 0 ? '' : `Objetivo ${i}`,
      retroalimentacion_familia: i === 1 ? 'Piden tareas' : '',
    });
  }
  return { repo, paciente };
}

async function borradorBase() {
  const { repo, paciente } = await escenario();
  const b = await compilarBorradorDePaciente(repo, paciente.id, '2026-03-01', '2026-03-31', 'tera@ejemplo.cl');
  if (b === null) throw new Error('borrador esperado');
  return { repo, paciente, b };
}

describe('escaparHtml', () => {
  it('escapa & < > " y comilla simple', () => {
    expect(escaparHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('no altera texto inocuo', () => {
    expect(escaparHtml('Sesión 1: ñandú')).toBe('Sesión 1: ñandú');
  });
});

describe('rango de fechas', () => {
  it('valida formato, fechas reales y orden', () => {
    expect(validarRango('2026-03-01', '2026-03-31')).toBeNull();
    expect(validarRango('2026-03-01', '2026-03-01')).toBeNull();
    expect(validarRango('01-03-2026', '2026-03-31')).toBe(MENSAJES_RANGO.formato);
    expect(validarRango('2026-02-30', '2026-03-31')).toBe(MENSAJES_RANGO.formato);
    expect(validarRango('2026-04-01', '2026-03-31')).toBe(MENSAJES_RANGO.orden);
  });

  it('incluye los extremos y ordena de la más antigua a la más reciente', async () => {
    const { repo, paciente } = await escenario();
    const entradas = await listarHistorial(repo, paciente.id);
    const dentro = filtrarSesionesPorRango(entradas, '2026-03-05', '2026-03-20');
    expect(dentro.map((e) => e.registro.observaciones)).toEqual(['Primera sesión', 'Segunda sesión']);
  });

  it('un rango inválido no devuelve sesiones', async () => {
    const { repo, paciente } = await escenario();
    const entradas = await listarHistorial(repo, paciente.id);
    expect(filtrarSesionesPorRango(entradas, '2026-04-30', '2026-01-01')).toEqual([]);
  });
});

describe('compilación del borrador', () => {
  it('reúne la evolución por categoría y deja 3 secciones vacías (sin IA)', async () => {
    const { b } = await borradorBase();
    expect(b.total_sesiones).toBe(2);
    expect(b.profesional).toBe('tera@ejemplo.cl');
    expect(b.antecedentes).toBe('Prematura');
    expect(b.motivo_consulta).toBe('Integración sensorial');
    expect(b.evolucion.observaciones.map((i) => i.texto)).toEqual(['Primera sesión', 'Segunda sesión']);
    // La sesión de abril queda fuera y los textos vacíos no generan ítems.
    expect(b.evolucion.objetivos_cumplidos.map((i) => i.texto)).toEqual(['Objetivo 1']);
    expect(b.evolucion.retroalimentacion_familia.map((i) => i.texto)).toEqual(['Piden tareas']);
    expect([b.evaluacion, b.diagnostico_ocupacional, b.recomendaciones]).toEqual(['', '', '']);
  });

  it('sin sesiones en el rango devuelve null', async () => {
    const { repo, paciente } = await escenario();
    expect(await compilarBorradorDePaciente(repo, paciente.id, '2025-01-01', '2025-12-31', 'x')).toBeNull();
  });

  it('un paciente inexistente o archivado devuelve null', async () => {
    const { repo, paciente } = await escenario();
    expect(await compilarBorradorDePaciente(repo, 'no-existe', '2026-01-01', '2026-12-31', 'x')).toBeNull();
    await repo.archivarPaciente(paciente.id);
    expect(await compilarBorradorDePaciente(repo, paciente.id, '2026-01-01', '2026-12-31', 'x')).toBeNull();
  });

  it('usa la hora de emisión inyectada', async () => {
    const { repo, paciente } = await escenario();
    const entradas = await listarHistorial(repo, paciente.id);
    const b = compilarBorrador({
      paciente,
      entradas,
      fechaInicio: '2026-03-01',
      fechaFin: '2026-03-31',
      profesional: 'x',
      ahora: () => '2026-06-01T12:00:00.000Z',
    });
    expect(b?.emitido_en).toBe('2026-06-01T12:00:00.000Z');
  });
});

describe('edición previa a exportar', () => {
  it('edita y elimina texto sin mutar el original ni los registros clínicos', async () => {
    const { repo, paciente, b: original } = await borradorBase();
    const primero = original.evolucion.observaciones[0];
    if (primero === undefined) throw new Error('ítem esperado');

    const editado = editarItem(original, 'observaciones', primero.id, 'Texto corregido');
    expect(editado.evolucion.observaciones[0]?.texto).toBe('Texto corregido');
    expect(original.evolucion.observaciones[0]?.texto).toBe('Primera sesión');

    const sinItem = eliminarItem(editado, 'observaciones', primero.id);
    expect(sinItem.evolucion.observaciones.map((i) => i.id)).not.toContain(primero.id);
    expect(construirHtml(sinItem)).not.toContain('Texto corregido');

    const conEval = editarCampo(sinItem, 'evaluacion', 'Evaluación escrita a mano');
    expect(construirHtml(conEval)).toContain('Evaluación escrita a mano');

    const historial = await listarHistorial(repo, paciente.id);
    expect(historial.some((e) => e.registro.observaciones === 'Primera sesión')).toBe(true);
  });
});

describe('HTML del informe', () => {
  it('contiene encabezado y secciones en orden', async () => {
    const { b } = await borradorBase();
    const html = construirHtml(b);
    const titulos = [
      'Informe de terapia ocupacional',
      'Antecedentes',
      'Motivo de consulta',
      'Evolución cronológica',
      ...CATEGORIAS_EVOLUCION.map((c) => c.titulo),
      'Evaluación',
      'Diagnóstico ocupacional',
      'Recomendaciones',
    ];
    let posicion = -1;
    for (const titulo of titulos) {
      const siguiente = html.indexOf(titulo, posicion + 1);
      expect(siguiente).toBeGreaterThan(posicion);
      posicion = siguiente;
    }
    expect(html).toContain('tera@ejemplo.cl');
    expect(html).toContain('04-05-2019');
  });

  it('escapa <script> y comillas en TODAS las variables interpoladas', async () => {
    const { b: base } = await borradorBase();
    const ataque = '<script>alert("xss")</script>';
    let b = { ...base, profesional: ataque, paciente_nombre: ataque };
    b = editarCampo(b, 'antecedentes', ataque);
    b = editarCampo(b, 'motivo_consulta', ataque);
    b = editarCampo(b, 'evaluacion', ataque);
    b = editarCampo(b, 'diagnostico_ocupacional', ataque);
    b = editarCampo(b, 'recomendaciones', ataque);
    for (const { clave } of CATEGORIAS_EVOLUCION) {
      for (const item of b.evolucion[clave]) b = editarItem(b, clave, item.id, ataque);
    }
    const html = construirHtml(b);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('</script');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(construirHtml(base)).toContain('Ana &lt;Pérez&gt; &amp; &quot;Hijos&quot;');
  });

  it('convierte saltos de línea y muestra «—» en secciones vacías', async () => {
    const { b } = await borradorBase();
    const html = construirHtml(editarCampo(b, 'recomendaciones', 'línea 1\nlínea 2'));
    expect(html).toContain('línea 1<br/>línea 2');
    expect(html).toContain('<p class="vacio">—</p>');
  });
});

describe('formatearFecha', () => {
  it('formatea AAAA-MM-DD, ISO e inválidos', () => {
    expect(formatearFecha('2026-03-05')).toBe('05-03-2026');
    expect(formatearFecha(mediodia(2026, 3, 5))).toBe('05-03-2026');
    expect(formatearFecha('no es fecha')).toBe('');
  });
});

describe('generarYCompartirPdf', () => {
  function dependencias(disponible: boolean) {
    const llamadas: string[] = [];
    const deps: DependenciasPdf = {
      imprimirAArchivo: jest.fn(async (html: string) => {
        llamadas.push(`imprimir:${html.includes('<html')}`);
        return 'file:///cache/informe.pdf';
      }),
      compartirDisponible: jest.fn(async () => disponible),
      compartir: jest.fn(async (uri: string) => {
        llamadas.push(`compartir:${uri}`);
      }),
    };
    return { deps, llamadas };
  }

  it('imprime a archivo local y lo comparte, sin llamadas de red', async () => {
    const fetchEspia = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('el PDF no debe subirse');
    });
    const { deps, llamadas } = dependencias(true);
    const { b } = await borradorBase();
    expect(await generarYCompartirPdf(b, deps)).toBe('compartido');
    expect(llamadas).toEqual(['imprimir:true', 'compartir:file:///cache/informe.pdf']);
    expect(fetchEspia).not.toHaveBeenCalled();
    fetchEspia.mockRestore();
  });

  it('informa si el teléfono no puede compartir', async () => {
    const { deps } = dependencias(false);
    const { b } = await borradorBase();
    expect(await generarYCompartirPdf(b, deps)).toBe('no_disponible');
    expect(deps.compartir).not.toHaveBeenCalled();
  });

  it('rechaza un borrador sin sesiones', async () => {
    const { deps } = dependencias(true);
    const { b } = await borradorBase();
    await expect(generarYCompartirPdf({ ...b, total_sesiones: 0 }, deps)).rejects.toThrow();
    expect(deps.imprimirAArchivo).not.toHaveBeenCalled();
  });
});
