/** E3 — Pacientes: lista activa con buscador y ficha con resumen de la última sesión. */
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import type { IRepositorioClinico } from '../data/repositorio';
import type { Apoderado, Paciente } from '../data/tipos';
import {
  ResumenUltimaSesion,
  filtrarPacientes,
  obtenerResumenUltimaSesion,
} from '../modules/pacientes-agenda/servicio';
import { formatearFechaHoraCita } from '../modules/pacientes-agenda/whatsapp';
import { BotonPrimario, BotonSecundario, CampoTexto, Tarjeta } from '../ui/componentes';
import { ESCALA_FUENTE_MAXIMA, colores, tipografia } from '../ui/tema';
import { MensajeError, Pantalla, Parrafo, Subtitulo, Titulo } from './base';

export const TEXTO_SIN_RESULTADOS = 'Sin resultados';
export const TEXTO_SIN_SESIONES = 'Sin sesiones registradas';
export const MENSAJE_ERROR_PACIENTES = 'No se pudieron cargar los pacientes. Inténtalo de nuevo.';

export interface PropsPacientes {
  readonly repositorio: IRepositorioClinico;
  readonly alNuevoPaciente: () => void;
  readonly alEditar: (pacienteId: string) => void;
  readonly alAgendar: (pacienteId: string) => void;
  readonly alHistorial: (pacienteId: string) => void;
  readonly alBorrador: (pacienteId: string) => void;
}

function Ficha({
  paciente,
  apoderado,
  props,
  alVolver,
}: {
  paciente: Paciente;
  apoderado: Apoderado | null;
  props: PropsPacientes;
  alVolver: () => void;
}) {
  const [resumen, setResumen] = useState<ResumenUltimaSesion | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    obtenerResumenUltimaSesion(props.repositorio, paciente.id)
      .then((r) => {
        if (activo) setResumen(r);
      })
      .catch(() => {
        if (activo) setError(MENSAJE_ERROR_PACIENTES);
      });
    return () => {
      activo = false;
    };
  }, [props.repositorio, paciente.id]);

  return (
    <Pantalla testID="ficha-paciente">
      <BotonSecundario titulo="Volver a pacientes" onPress={alVolver} />
      <Titulo>{paciente.nombre}</Titulo>
      {apoderado !== null ? <Parrafo>{`Apoderado: ${apoderado.nombre}`}</Parrafo> : null}
      <MensajeError mensaje={error} />
      <Subtitulo>Resumen de última sesión</Subtitulo>
      {resumen === undefined ? null : resumen === null ? (
        <Parrafo>{TEXTO_SIN_SESIONES}</Parrafo>
      ) : (
        <Tarjeta testID="resumen-ultima-sesion">
          <Text style={{ ...tipografia.auxiliar, color: colores.textoSecundario }} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
            {formatearFechaHoraCita(resumen.fecha_hora)}
          </Text>
          {resumen.secciones.map(({ titulo, texto }) => (
            <React.Fragment key={titulo}>
              <Subtitulo>{titulo}</Subtitulo>
              <Parrafo>{texto.length > 0 ? texto : '—'}</Parrafo>
            </React.Fragment>
          ))}
        </Tarjeta>
      )}
      <BotonPrimario titulo="Agendar cita" onPress={() => props.alAgendar(paciente.id)} />
      <BotonSecundario titulo="Editar paciente" onPress={() => props.alEditar(paciente.id)} />
      <BotonSecundario titulo="Ver historial" onPress={() => props.alHistorial(paciente.id)} />
      <BotonSecundario titulo="Ver borrador" onPress={() => props.alBorrador(paciente.id)} />
    </Pantalla>
  );
}

export function Pacientes(props: PropsPacientes) {
  const { repositorio } = props;
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [apoderados, setApoderados] = useState<Apoderado[]>([]);
  const [consulta, setConsulta] = useState('');
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    Promise.all([repositorio.listarPacientes(), repositorio.listarApoderados()])
      .then(([listaPacientes, listaApoderados]) => {
        if (!activo) return;
        setPacientes(listaPacientes);
        setApoderados(listaApoderados);
        setError(null);
      })
      .catch(() => {
        if (activo) setError(MENSAJE_ERROR_PACIENTES);
      });
    return () => {
      activo = false;
    };
  }, [repositorio]);

  const paciente = pacientes.find((p) => p.id === seleccionado);
  if (paciente !== undefined && !paciente.archivado) {
    const apoderado = apoderados.find((a) => a.id === paciente.apoderado_id) ?? null;
    return <Ficha paciente={paciente} apoderado={apoderado} props={props} alVolver={() => setSeleccionado(null)} />;
  }

  const visibles = filtrarPacientes(pacientes, consulta);
  return (
    <Pantalla testID="pantalla-pacientes">
      <Titulo>Pacientes</Titulo>
      <MensajeError mensaje={error} />
      <CampoTexto
        etiqueta="Buscar paciente"
        value={consulta}
        onChangeText={setConsulta}
        autoCorrect={false}
        returnKeyType="search"
      />
      <BotonPrimario titulo="Nuevo paciente" onPress={props.alNuevoPaciente} />
      {visibles.length === 0 ? (
        <Parrafo>{consulta.trim().length > 0 ? TEXTO_SIN_RESULTADOS : 'Aún no hay pacientes.'}</Parrafo>
      ) : (
        visibles.map((p) => (
          <Tarjeta
            key={p.id}
            testID={`paciente-${p.id}`}
            onPress={() => setSeleccionado(p.id)}
            accessibilityLabel={`Abrir ficha de ${p.nombre}`}
          >
            <Text style={{ ...tipografia.cuerpoDestacado, color: colores.texto }} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
              {p.nombre}
            </Text>
          </Tarjeta>
        ))
      )}
    </Pantalla>
  );
}
