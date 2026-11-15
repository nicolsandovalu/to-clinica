/** E5/C4 — Borrador de informe: paciente, rango de fechas, edición y PDF local. */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { IRepositorioClinico } from '../data/repositorio';
import type { Paciente } from '../data/tipos';
import {
  BorradorInforme,
  CATEGORIAS_EVOLUCION,
  DependenciasPdf,
  SECCIONES_EDITABLES,
  TEXTO_SIN_SESIONES_RANGO,
  compilarBorradorDePaciente,
  editarCampo,
  editarItem,
  eliminarItem,
  formatearFecha,
  generarYCompartirPdf,
  validarRango,
} from '../modules/informes/pdf';
import { BotonPrimario, BotonSecundario, CampoTexto, Tarjeta } from '../ui/componentes';
import { AREA_TACTIL_MINIMA, ESCALA_FUENTE_MAXIMA, colores, espaciado, tipografia } from '../ui/tema';
import { MensajeError, Pantalla, Parrafo, Subtitulo, Titulo } from './base';

export const MENSAJE_ERROR_BORRADOR = 'No se pudo preparar el informe. Inténtalo de nuevo.';
export const MENSAJE_ERROR_PDF = 'No se pudo generar el PDF. Inténtalo de nuevo.';
export const MENSAJE_PDF_NO_DISPONIBLE = 'Este teléfono no permite compartir archivos.';
export const MENSAJE_ELIGE_PACIENTE = 'Elige un paciente.';

export interface PropsBorrador {
  readonly repositorio: IRepositorioClinico;
  /** Paciente preseleccionado (p. ej. desde su ficha). */
  readonly pacienteId?: string;
  /** Nombre o correo que aparece en el encabezado profesional. */
  readonly profesional: string;
  readonly alVolver: () => void;
  /** Inyectable para pruebas; por defecto `expo-print` + `expo-sharing`. */
  readonly dependenciasPdf?: DependenciasPdf;
}

function hoyISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function Borrador({ repositorio, pacienteId, profesional, alVolver, dependenciasPdf }: PropsBorrador) {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [seleccionado, setSeleccionado] = useState<string | null>(pacienteId ?? null);
  const [fechaInicio, setFechaInicio] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [fechaFin, setFechaFin] = useState(hoyISO);
  const [borrador, setBorrador] = useState<BorradorInforme | null>(null);
  const [sinSesiones, setSinSesiones] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let activo = true;
    repositorio
      .listarPacientes()
      .then((lista) => {
        if (activo) setPacientes(lista);
      })
      .catch(() => {
        if (activo) setError(MENSAJE_ERROR_BORRADOR);
      });
    return () => {
      activo = false;
    };
  }, [repositorio]);

  const limpiarResultado = () => {
    setBorrador(null);
    setSinSesiones(false);
    setAviso(null);
  };

  const compilar = async () => {
    limpiarResultado();
    if (seleccionado === null) {
      setError(MENSAJE_ELIGE_PACIENTE);
      return;
    }
    const errorRango = validarRango(fechaInicio, fechaFin);
    if (errorRango !== null) {
      setError(errorRango);
      return;
    }
    setError(null);
    setOcupado(true);
    try {
      const resultado = await compilarBorradorDePaciente(
        repositorio,
        seleccionado,
        fechaInicio,
        fechaFin,
        profesional,
      );
      setBorrador(resultado);
      setSinSesiones(resultado === null);
    } catch {
      setError(MENSAJE_ERROR_BORRADOR);
    } finally {
      setOcupado(false);
    }
  };

  const exportar = async () => {
    if (borrador === null) return;
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const resultado = await generarYCompartirPdf(borrador, dependenciasPdf);
      if (resultado === 'no_disponible') setAviso(MENSAJE_PDF_NO_DISPONIBLE);
    } catch {
      setError(MENSAJE_ERROR_PDF);
    } finally {
      setOcupado(false);
    }
  };

  const puedeGenerar = borrador !== null && borrador.total_sesiones > 0 && !ocupado;

  return (
    <Pantalla testID="pantalla-borrador">
      <BotonSecundario titulo="Volver" onPress={alVolver} />
      <Titulo>Borrador de informe</Titulo>
      <Parrafo>
        El borrador solo reúne el texto que ya registraste. Puedes editarlo o quitar fragmentos antes de generar el PDF.
      </Parrafo>
      <MensajeError mensaje={error} />

      <Subtitulo>Paciente</Subtitulo>
      <View style={estilos.opciones} accessibilityRole="radiogroup">
        {pacientes
          .filter((p) => !p.archivado)
          .map((p) => {
            const activo = p.id === seleccionado;
            return (
              <Pressable
                key={p.id}
                onPress={() => {
                  setSeleccionado(p.id);
                  limpiarResultado();
                }}
                accessibilityRole="radio"
                accessibilityLabel={p.nombre}
                accessibilityState={{ selected: activo }}
                testID={`informe-paciente-${p.id}`}
                style={[estilos.opcion, activo && estilos.opcionActiva]}
              >
                <Text style={estilos.textoOpcion} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
                  {activo ? '● ' : '○ '}
                  {p.nombre}
                </Text>
              </Pressable>
            );
          })}
        {pacientes.length === 0 ? <Parrafo>Aún no hay pacientes.</Parrafo> : null}
      </View>

      <Subtitulo>Rango de fechas</Subtitulo>
      <CampoTexto
        etiqueta="Fecha de inicio (AAAA-MM-DD)"
        value={fechaInicio}
        onChangeText={(t) => {
          setFechaInicio(t);
          limpiarResultado();
        }}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        testID="fecha-inicio"
      />
      <CampoTexto
        etiqueta="Fecha de fin (AAAA-MM-DD)"
        value={fechaFin}
        onChangeText={(t) => {
          setFechaFin(t);
          limpiarResultado();
        }}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        testID="fecha-fin"
      />
      <BotonPrimario titulo="Compilar borrador" onPress={() => void compilar()} cargando={ocupado} testID="compilar" />

      {sinSesiones ? (
        <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" testID="sin-sesiones-rango">
          <Parrafo>{TEXTO_SIN_SESIONES_RANGO}</Parrafo>
        </View>
      ) : null}

      {borrador !== null ? (
        <>
          <Tarjeta testID="encabezado-informe">
            <Text style={estilos.destacado} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
              {borrador.paciente_nombre}
            </Text>
            <Parrafo>{`Profesional: ${borrador.profesional}`}</Parrafo>
            <Parrafo>
              {`Período: ${formatearFecha(borrador.fecha_inicio)} al ${formatearFecha(borrador.fecha_fin)} · ${borrador.total_sesiones} sesiones`}
            </Parrafo>
          </Tarjeta>

          <CampoTexto
            etiqueta="Antecedentes"
            value={borrador.antecedentes}
            onChangeText={(t) => setBorrador(editarCampo(borrador, 'antecedentes', t))}
            multiline
            testID="campo-antecedentes"
          />
          <CampoTexto
            etiqueta="Motivo de consulta"
            value={borrador.motivo_consulta}
            onChangeText={(t) => setBorrador(editarCampo(borrador, 'motivo_consulta', t))}
            multiline
            testID="campo-motivo_consulta"
          />

          <Subtitulo>Evolución cronológica</Subtitulo>
          {CATEGORIAS_EVOLUCION.map(({ clave, titulo }) => (
            <View key={clave} style={estilos.grupo}>
              <Text style={estilos.destacado} accessibilityRole="header" maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
                {titulo}
              </Text>
              {borrador.evolucion[clave].length === 0 ? <Parrafo>—</Parrafo> : null}
              {borrador.evolucion[clave].map((item) => (
                <Tarjeta key={item.id} testID={`item-${clave}-${item.id}`}>
                  <Text style={estilos.auxiliar} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
                    {formatearFecha(item.fecha_hora)}
                  </Text>
                  <CampoTexto
                    etiqueta={`${titulo} del ${formatearFecha(item.fecha_hora)}`}
                    value={item.texto}
                    onChangeText={(t) => setBorrador(editarItem(borrador, clave, item.id, t))}
                    multiline
                    testID={`texto-${clave}-${item.id}`}
                  />
                  <BotonSecundario
                    titulo="Quitar del informe"
                    accessibilityLabel={`Quitar ${titulo} del ${formatearFecha(item.fecha_hora)} del informe`}
                    onPress={() => setBorrador(eliminarItem(borrador, clave, item.id))}
                    testID={`quitar-${clave}-${item.id}`}
                  />
                </Tarjeta>
              ))}
            </View>
          ))}

          {SECCIONES_EDITABLES.map(({ clave, titulo }) => (
            <CampoTexto
              key={clave}
              etiqueta={titulo}
              value={borrador[clave]}
              onChangeText={(t) => setBorrador(editarCampo(borrador, clave, t))}
              multiline
              testID={`campo-${clave}`}
            />
          ))}
        </>
      ) : null}

      {aviso !== null ? <Parrafo>{aviso}</Parrafo> : null}
      <BotonPrimario
        titulo="Generar y compartir PDF"
        onPress={() => void exportar()}
        deshabilitado={!puedeGenerar}
        cargando={ocupado && borrador !== null}
        accessibilityHint="El PDF se crea en este teléfono y no se sube al servidor"
        testID="generar-pdf"
      />
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  opciones: { gap: espaciado.s },
  opcion: {
    minHeight: AREA_TACTIL_MINIMA,
    justifyContent: 'center',
    paddingHorizontal: espaciado.m,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colores.borde,
  },
  opcionActiva: { borderColor: colores.foco },
  textoOpcion: { ...tipografia.cuerpo, color: colores.texto },
  destacado: { ...tipografia.cuerpoDestacado, color: colores.texto },
  auxiliar: { ...tipografia.auxiliar, color: colores.textoSecundario },
  grupo: { gap: espaciado.s },
});
