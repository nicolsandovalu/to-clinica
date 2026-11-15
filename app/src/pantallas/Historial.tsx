/** Historial — sesiones activas del paciente (más reciente primero) con edición. */
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';

import type { IRepositorioClinico } from '../data/repositorio';
import {
  CamposSesion,
  EntradaHistorial,
  editarSesionHistorica,
  listarHistorial,
} from '../modules/registro/servicio';
import { formatearFechaHoraCita } from '../modules/pacientes-agenda/whatsapp';
import { BotonPrimario, BotonSecundario, CampoTexto, Tarjeta } from '../ui/componentes';
import { ESCALA_FUENTE_MAXIMA, colores, tipografia } from '../ui/tema';
import { MensajeError, Pantalla, Parrafo, Titulo } from './base';
import { CAMPOS_REGISTRO } from './Registro';

export const TEXTO_SIN_SESIONES_HISTORIAL = 'Sin sesiones registradas';
export const MENSAJE_ERROR_HISTORIAL = 'No se pudo cargar el historial. Inténtalo de nuevo.';
export const TEXTO_SYNC = { pendiente: 'Pendiente de sincronizar', sincronizado: 'Sincronizada' } as const;

export interface PropsHistorial {
  readonly repositorio: IRepositorioClinico;
  readonly pacienteId: string;
  readonly alVolver: () => void;
}

function formatear(iso: string): string {
  return formatearFechaHoraCita(iso);
}

function FilaEdicion({
  entrada,
  alGuardar,
  alCancelar,
}: {
  entrada: EntradaHistorial;
  alGuardar: (campos: CamposSesion) => Promise<void>;
  alCancelar: () => void;
}) {
  const r = entrada.registro;
  const [campos, setCampos] = useState<CamposSesion>({
    observaciones: r.observaciones,
    objetivos_cumplidos: r.objetivos_cumplidos,
    retroalimentacion_familia: r.retroalimentacion_familia,
  });
  const [ocupado, setOcupado] = useState(false);
  return (
    <>
      {CAMPOS_REGISTRO.map(({ clave, etiqueta }) => (
        <CampoTexto
          key={clave}
          etiqueta={etiqueta}
          value={campos[clave]}
          onChangeText={(texto) => setCampos((previo) => ({ ...previo, [clave]: texto }))}
          multiline
          testID={`editar-${clave}`}
        />
      ))}
      <BotonPrimario
        titulo="Guardar cambios"
        cargando={ocupado}
        testID={`guardar-${r.id}`}
        onPress={() => {
          setOcupado(true);
          void alGuardar(campos).finally(() => setOcupado(false));
        }}
      />
      <BotonSecundario titulo="Cancelar" onPress={alCancelar} testID={`cancelar-${r.id}`} />
    </>
  );
}

export function Historial({ repositorio, pacienteId, alVolver }: PropsHistorial) {
  const [entradas, setEntradas] = useState<EntradaHistorial[] | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let activo = true;
    listarHistorial(repositorio, pacienteId)
      .then((lista) => {
        if (!activo) return;
        setEntradas(lista);
        setError(null);
      })
      .catch(() => {
        if (activo) setError(MENSAJE_ERROR_HISTORIAL);
      });
    return () => {
      activo = false;
    };
  }, [repositorio, pacienteId, recarga]);

  const guardar = async (registroId: string, campos: CamposSesion) => {
    try {
      await editarSesionHistorica(repositorio, registroId, campos);
      setEditando(null);
      setRecarga((n) => n + 1);
    } catch {
      setError(MENSAJE_ERROR_HISTORIAL);
    }
  };

  return (
    <Pantalla testID="pantalla-historial">
      <BotonSecundario titulo="Volver" onPress={alVolver} />
      <Titulo>Historial de sesiones</Titulo>
      <MensajeError mensaje={error} />
      {entradas !== null && entradas.length === 0 ? (
        <Parrafo>{TEXTO_SIN_SESIONES_HISTORIAL}</Parrafo>
      ) : null}
      {(entradas ?? []).map((entrada) => {
        const r = entrada.registro;
        return (
          <Tarjeta key={r.id} testID={`sesion-${r.id}`}>
            <Text style={{ ...tipografia.cuerpoDestacado, color: colores.texto }} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
              Creada: {formatear(r.creado_en)}
            </Text>
            <Parrafo>Modificada: {formatear(r.modificado_en)}</Parrafo>
            <Text
              style={{ ...tipografia.auxiliar, color: colores.textoSecundario }}
              maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
              testID={`sync-${r.id}`}
            >
              {entrada.estado_sync === 'pendiente' ? '⏳ ' : '✓ '}
              {TEXTO_SYNC[entrada.estado_sync]}
            </Text>
            {editando === r.id ? (
              <FilaEdicion
                entrada={entrada}
                alGuardar={(campos) => guardar(r.id, campos)}
                alCancelar={() => setEditando(null)}
              />
            ) : (
              <>
                {CAMPOS_REGISTRO.map(({ clave, etiqueta }) => (
                  <Parrafo key={clave}>
                    {etiqueta}: {r[clave].length > 0 ? r[clave] : '—'}
                  </Parrafo>
                ))}
                <BotonSecundario
                  titulo="Editar"
                  accessibilityLabel={`Editar sesión del ${formatear(r.creado_en)}`}
                  onPress={() => setEditando(r.id)}
                  testID={`editar-${r.id}`}
                />
              </>
            )}
          </Tarjeta>
        );
      })}
    </Pantalla>
  );
}
