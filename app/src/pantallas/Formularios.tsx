/** C2/C3 — Formularios: paciente con apoderado (crear/editar/archivar) y cita (crear/editar/cancelar). */
import React, { useEffect, useState } from 'react';

import type { IRepositorioClinico } from '../data/repositorio';
import {
  DatosFormularioPaciente,
  archivarPaciente,
  combinarFechaHora,
  guardarPacienteConApoderado,
} from '../modules/pacientes-agenda/servicio';
import { normalizarFecha, normalizarYValidarTelefonoChileno } from '../modules/pacientes-agenda/validaciones';
import { BotonPrimario, BotonSecundario, CampoTexto } from '../ui/componentes';
import { MensajeError, Pantalla, Titulo } from './base';

export const MENSAJES_FORMULARIO = {
  nombreObligatorio: 'Ingresa el nombre del paciente.',
  fechaNacimiento: 'Escribe una fecha real, por ejemplo 19-11-1996.',
  fechaHora: 'Ingresa una fecha (por ejemplo 25-11-2026) y una hora (HH:MM) válidas.',
  guardar: 'No se pudo guardar. Inténtalo de nuevo.',
} as const;


function dos(n: number): string {
  return String(n).padStart(2, '0');
}

// ---------- C2: paciente y apoderado ----------

export interface PropsFormularioPaciente {
  readonly repositorio: IRepositorioClinico;
  readonly propietariaId: string;
  /** Si se indica, edita ese paciente; si no, crea uno nuevo. */
  readonly pacienteId?: string;
  readonly alTerminar: () => void;
  readonly alCancelar: () => void;
}

export function FormularioPaciente({
  repositorio,
  propietariaId,
  pacienteId,
  alTerminar,
  alCancelar,
}: PropsFormularioPaciente) {
  const [nombre, setNombre] = useState('');
  const [nacimiento, setNacimiento] = useState('');
  const [antecedentes, setAntecedentes] = useState('');
  const [motivo, setMotivo] = useState('');
  const [apoderado, setApoderado] = useState('');
  const [telefono, setTelefono] = useState('');
  const [errores, setErrores] = useState<Record<string, string | null>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (pacienteId === undefined) return;
    let activo = true;
    void (async () => {
      try {
        const p = await repositorio.obtenerPaciente(pacienteId);
        if (p === null || !activo) return;
        const a = p.apoderado_id === null ? null : await repositorio.obtenerApoderado(p.apoderado_id);
        if (!activo) return;
        setNombre(p.nombre);
        setNacimiento(p.fecha_nacimiento ?? '');
        setAntecedentes(p.antecedentes);
        setMotivo(p.motivo_consulta);
        setApoderado(a?.nombre ?? '');
        setTelefono(a?.telefono ?? '');
      } catch {
        if (activo) setErrorGeneral(MENSAJES_FORMULARIO.guardar);
      }
    })();
    return () => {
      activo = false;
    };
  }, [repositorio, pacienteId]);

  const guardar = async () => {
    const tel = normalizarYValidarTelefonoChileno(telefono);
    const nuevos = {
      nombre: nombre.trim().length === 0 ? MENSAJES_FORMULARIO.nombreObligatorio : null,
      nacimiento:
        nacimiento.trim().length > 0 && normalizarFecha(nacimiento) === null
          ? MENSAJES_FORMULARIO.fechaNacimiento
          : null,
      telefono: tel.error,
    };
    setErrores(nuevos);
    if (Object.values(nuevos).some((e) => e !== null)) return;
    const datos: DatosFormularioPaciente = {
      nombre,
      fecha_nacimiento: nacimiento.trim().length > 0 ? normalizarFecha(nacimiento) : null,
      antecedentes,
      motivo_consulta: motivo,
      apoderado_nombre: apoderado,
      apoderado_telefono: tel.telefono,
    };
    setOcupado(true);
    try {
      await guardarPacienteConApoderado(repositorio, propietariaId, datos, pacienteId);
      alTerminar();
    } catch {
      setErrorGeneral(MENSAJES_FORMULARIO.guardar);
    } finally {
      setOcupado(false);
    }
  };

  const archivar = async () => {
    if (pacienteId === undefined) return;
    setOcupado(true);
    try {
      await archivarPaciente(repositorio, pacienteId);
      alTerminar();
    } catch {
      setErrorGeneral(MENSAJES_FORMULARIO.guardar);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Pantalla testID="formulario-paciente">
      <Titulo>{pacienteId === undefined ? 'Nuevo paciente' : 'Editar paciente'}</Titulo>
      <MensajeError mensaje={errorGeneral} />
      <CampoTexto etiqueta="Nombre del paciente" value={nombre} onChangeText={setNombre} error={errores.nombre} />
      <CampoTexto
        etiqueta="Fecha de nacimiento (opcional)"
        ayuda="Día-mes-año, por ejemplo 19-11-1996"
        value={nacimiento}
        onChangeText={setNacimiento}
        error={errores.nacimiento}
        keyboardType="numbers-and-punctuation"
      />
      <CampoTexto etiqueta="Motivo de consulta" value={motivo} onChangeText={setMotivo} multiline />
      <CampoTexto etiqueta="Antecedentes" value={antecedentes} onChangeText={setAntecedentes} multiline />
      <CampoTexto etiqueta="Nombre del apoderado (opcional)" value={apoderado} onChangeText={setApoderado} />
      <CampoTexto
        etiqueta="Teléfono del apoderado (opcional)"
        ayuda="Formato +569XXXXXXXX"
        value={telefono}
        onChangeText={setTelefono}
        error={errores.telefono}
        keyboardType="phone-pad"
      />
      <BotonPrimario titulo="Guardar" onPress={() => void guardar()} cargando={ocupado} />
      {pacienteId !== undefined ? (
        <BotonSecundario
          titulo="Archivar paciente"
          accessibilityHint="El paciente deja de aparecer en la lista, pero su historial se conserva"
          onPress={() => void archivar()}
          deshabilitado={ocupado}
        />
      ) : null}
      <BotonSecundario titulo="Cancelar" onPress={alCancelar} deshabilitado={ocupado} />
    </Pantalla>
  );
}

// ---------- C3: cita ----------

export interface PropsFormularioCita {
  readonly repositorio: IRepositorioClinico;
  readonly pacienteId: string;
  /** Si se indica, edita esa cita; si no, crea una nueva. */
  readonly citaId?: string;
  readonly alTerminar: () => void;
  readonly alVolver: () => void;
}

function fechaDeHoy(): string {
  const h = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(h.getDate())}-${dos(h.getMonth() + 1)}-${h.getFullYear()}`;
}

export function FormularioCita({ repositorio, pacienteId, citaId, alTerminar, alVolver }: PropsFormularioCita) {
  const [fecha, setFecha] = useState(fechaDeHoy);
  const [hora, setHora] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (citaId === undefined) return;
    let activo = true;
    void (async () => {
      try {
        const c = await repositorio.obtenerCita(citaId);
        if (c === null || !activo) return;
        const d = new Date(c.fecha_hora);
        setFecha(`${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`);
        setHora(`${dos(d.getHours())}:${dos(d.getMinutes())}`);
      } catch {
        if (activo) setErrorGeneral(MENSAJES_FORMULARIO.guardar);
      }
    })();
    return () => {
      activo = false;
    };
  }, [repositorio, citaId]);

  const guardar = async () => {
    const iso = combinarFechaHora(normalizarFecha(fecha) ?? fecha, hora);
    if (iso === null) {
      setError(MENSAJES_FORMULARIO.fechaHora);
      return;
    }
    setError(null);
    setOcupado(true);
    try {
      if (citaId === undefined) await repositorio.crearCita({ paciente_id: pacienteId, fecha_hora: iso });
      else await repositorio.actualizarCita(citaId, { fecha_hora: iso });
      alTerminar();
    } catch {
      setErrorGeneral(MENSAJES_FORMULARIO.guardar);
    } finally {
      setOcupado(false);
    }
  };

  /** Cancelar no elimina: solo marca la cita como `cancelada`. */
  const cancelarCita = async () => {
    if (citaId === undefined) return;
    setOcupado(true);
    try {
      await repositorio.actualizarCita(citaId, { estado: 'cancelada' });
      alTerminar();
    } catch {
      setErrorGeneral(MENSAJES_FORMULARIO.guardar);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Pantalla testID="formulario-cita">
      <Titulo>{citaId === undefined ? 'Agendar cita' : 'Editar cita'}</Titulo>
      <MensajeError mensaje={errorGeneral} />
      <CampoTexto
        etiqueta="Fecha"
        ayuda="Día-mes-año, por ejemplo 19-11-1996"
        value={fecha}
        onChangeText={setFecha}
        keyboardType="numbers-and-punctuation"
      />
      <CampoTexto
        etiqueta="Hora"
        ayuda="Formato HH:MM, 24 horas"
        value={hora}
        onChangeText={setHora}
        error={error}
        keyboardType="numbers-and-punctuation"
      />
      <BotonPrimario titulo="Guardar cita" onPress={() => void guardar()} cargando={ocupado} />
      {citaId !== undefined ? (
        <BotonSecundario
          titulo="Cancelar cita"
          accessibilityHint="Marca la cita como cancelada; no se borra"
          onPress={() => void cancelarCita()}
          deshabilitado={ocupado}
        />
      ) : null}
      <BotonSecundario titulo="Volver" onPress={alVolver} deshabilitado={ocupado} />
    </Pantalla>
  );
}
