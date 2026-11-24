/** E4 — Registro de sesión: 3 campos independientes con dictado on-device y edición manual. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { IRepositorioClinico } from '../data/repositorio';
import {
  ControladorDictado,
  EstadoDictado,
  MotorDictado,
  anexarTexto,
  crearMotorExpo,
  mensajeErrorDictado,
} from '../modules/registro/dictado';
import {
  CAMPOS_VACIOS,
  CamposSesion,
  ContextoRegistro,
  cargarContextoRegistro,
  guardarSesion,
} from '../modules/registro/servicio';
import { formatearFechaHoraCita } from '../modules/pacientes-agenda/whatsapp';
import { Avatar, BotonPrimario, BotonSecundario, CampoTexto, Tarjeta } from '../ui/componentes';
import { AREA_TACTIL_MINIMA, ESCALA_FUENTE_MAXIMA, colores, espaciado, radios, tipografia } from '../ui/tema';
import { MensajeError, Pantalla, Parrafo, Titulo } from './base';

export const TEXTO_SESION_GUARDADA = 'Sesión guardada';
export const MENSAJE_ERROR_REGISTRO = 'No se pudo guardar la sesión. Inténtalo de nuevo.';
export const MENSAJE_ERROR_CARGA_REGISTRO = 'No se pudo abrir la cita. Vuelve a la agenda.';

export const CAMPOS_REGISTRO = [
  { clave: 'observaciones', etiqueta: 'Observaciones' },
  { clave: 'objetivos_cumplidos', etiqueta: 'Objetivos cumplidos' },
  {
    clave: 'retroalimentacion_familia',
    etiqueta: 'Retroalimentación o solicitudes de la familia',
  },
] as const satisfies readonly { clave: keyof CamposSesion; etiqueta: string }[];

export interface PropsRegistro {
  readonly repositorio: IRepositorioClinico;
  readonly citaId: string;
  /** Vuelve a E2 Agenda. */
  readonly alVerSiguiente: () => void;
  /** Motor de dictado inyectable; por defecto el nativo (o `null` si no existe). */
  readonly motorDictado?: MotorDictado | null;
}

export function BotonDictado({
  campo,
  activo,
  deshabilitado,
  alPulsar,
}: {
  campo: string;
  activo: boolean;
  deshabilitado: boolean;
  alPulsar: () => void;
}) {
  const titulo = activo ? 'Detener' : 'Dictar';
  return (
    <Pressable
      onPress={alPulsar}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityLabel={`${titulo} ${campo}`}
      accessibilityState={{ disabled: deshabilitado, selected: activo }}
      style={[estilos.botonDictado, activo && estilos.botonDictadoActivo, deshabilitado && estilos.botonInactivo]}
    >
      <Text
        style={[estilos.glifoDictado, activo && estilos.textoDictadoActivo, deshabilitado && estilos.textoInactivo]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {activo ? '■' : '●'}
      </Text>
      <Text
        style={[estilos.textoDictado, activo && estilos.textoDictadoActivo, deshabilitado && estilos.textoInactivo]}
        maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
      >
        {titulo}
      </Text>
    </Pressable>
  );
}

export function Registro({ repositorio, citaId, alVerSiguiente, motorDictado }: PropsRegistro) {
  const [contexto, setContexto] = useState<ContextoRegistro | null>(null);
  const [campos, setCampos] = useState<CamposSesion>(CAMPOS_VACIOS);
  const [antecedentesVisibles, setAntecedentesVisibles] = useState(false);
  const [estadoDictado, setEstadoDictado] = useState<EstadoDictado>({
    disponible: true,
    escuchando: false,
    aviso: null,
  });
  const [campoDictando, setCampoDictando] = useState<string | null>(null);
  const [avisoError, setAvisoError] = useState<string | null>(null);
  const [guardada, setGuardada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controlador = useRef<ControladorDictado | null>(null);
  if (controlador.current === null) {
    const motor = motorDictado === undefined ? crearMotorExpo() : motorDictado;
    controlador.current = new ControladorDictado(motor, {
      alTexto: (campo, texto) => {
        setGuardada(false);
        setCampos((previo) => ({
          ...previo,
          [campo]: anexarTexto(previo[campo as keyof CamposSesion], texto),
        }));
      },
      alCambiar: (estado) => {
        setEstadoDictado(estado);
        if (estado.escuchando) setAvisoError(null);
        if (!estado.escuchando) setCampoDictando(null);
      },
      alError: (codigo) => {
        const mensaje = mensajeErrorDictado(codigo);
        setAvisoError(mensaje.length > 0 ? mensaje : null);
      },
    });
  }

  useEffect(() => {
    const ctrl = controlador.current;
    return () => ctrl?.liberar();
  }, []);

  useEffect(() => {
    let activo = true;
    cargarContextoRegistro(repositorio, citaId)
      .then((ctx) => {
        if (!activo) return;
        if (ctx === null) {
          setError(MENSAJE_ERROR_CARGA_REGISTRO);
          return;
        }
        setContexto(ctx);
        if (ctx.registro !== null) {
          setCampos({
            observaciones: ctx.registro.observaciones,
            objetivos_cumplidos: ctx.registro.objetivos_cumplidos,
            retroalimentacion_familia: ctx.registro.retroalimentacion_familia,
          });
        }
      })
      .catch(() => {
        if (activo) setError(MENSAJE_ERROR_CARGA_REGISTRO);
      });
    return () => {
      activo = false;
    };
  }, [repositorio, citaId]);

  const alternarDictado = useCallback(async (clave: keyof CamposSesion) => {
    const ctrl = controlador.current;
    if (ctrl === null) return;
    if (ctrl.campo === clave) {
      ctrl.detener();
      return;
    }
    setCampoDictando(clave);
    await ctrl.iniciar(clave);
  }, []);

  const guardar = async () => {
    controlador.current?.detener();
    setGuardando(true);
    setError(null);
    try {
      await guardarSesion(repositorio, citaId, campos);
      setGuardada(true);
    } catch {
      setError(MENSAJE_ERROR_REGISTRO);
    } finally {
      setGuardando(false);
    }
  };

  const cambiarCampo = (clave: keyof CamposSesion, valor: string) => {
    setGuardada(false);
    setCampos((previo) => ({ ...previo, [clave]: valor }));
  };

  return (
    <Pantalla testID="pantalla-registro">
      <Titulo>Registro de sesión</Titulo>
      <MensajeError mensaje={error} />
      {contexto !== null ? (
        <Tarjeta testID="encabezado-registro">
          <View style={estilos.filaPaciente}>
            <Avatar nombre={contexto.paciente.nombre} />
            <View style={estilos.flexible}>
              <Text style={estilos.paciente} accessibilityRole="header" maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
                {contexto.paciente.nombre}
              </Text>
              <Parrafo>{formatearFechaHoraCita(contexto.cita.fecha_hora)}</Parrafo>
            </View>
          </View>
          <BotonSecundario
            titulo={antecedentesVisibles ? 'Ocultar antecedentes' : 'Ver antecedentes'}
            onPress={() => setAntecedentesVisibles((v) => !v)}
            testID="alternar-antecedentes"
          />
          {antecedentesVisibles ? (
            <View testID="antecedentes">
              <Parrafo>
                {contexto.paciente.antecedentes.length > 0
                  ? contexto.paciente.antecedentes
                  : 'Sin antecedentes registrados'}
              </Parrafo>
            </View>
          ) : null}
        </Tarjeta>
      ) : null}
      {avisoError !== null ? (
        <View accessible accessibilityRole="alert" style={estilos.aviso} testID="error-dictado">
          <Text style={estilos.textoAviso} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
            {avisoError}
          </Text>
        </View>
      ) : null}
      {estadoDictado.aviso !== null ? (
        <View accessible accessibilityRole="alert" style={estilos.aviso} testID="aviso-dictado">
          <Text style={estilos.textoAviso} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
            {estadoDictado.aviso}
          </Text>
        </View>
      ) : null}
      {CAMPOS_REGISTRO.map(({ clave, etiqueta }) => (
        <Tarjeta key={clave} style={estilos.bloqueCampo}>
          {campoDictando === clave && estadoDictado.escuchando ? (
            <Text style={estilos.escuchando} accessibilityLiveRegion="polite" maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
              ● Escuchando… habla ahora; toca Detener al terminar
            </Text>
          ) : null}
          <CampoTexto
            etiqueta={etiqueta}
            value={campos[clave]}
            onChangeText={(texto) => cambiarCampo(clave, texto)}
            multiline
            testID={`campo-${clave}`}
          />
          <BotonDictado
            campo={etiqueta}
            activo={campoDictando === clave && estadoDictado.escuchando}
            deshabilitado={!estadoDictado.disponible}
            alPulsar={() => void alternarDictado(clave)}
          />
        </Tarjeta>
      ))}
      <BotonPrimario
        titulo="Guardar sesión"
        onPress={() => void guardar()}
        cargando={guardando}
        deshabilitado={contexto === null}
        testID="guardar-sesion"
      />
      {guardada ? (
        <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={estilos.exito}>
          <Text style={estilos.textoExito} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
            {TEXTO_SESION_GUARDADA}
          </Text>
          <BotonSecundario
            titulo="Ver siguiente paciente"
            onPress={alVerSiguiente}
            testID="ver-siguiente"
          />
        </View>
      ) : null}
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  paciente: { ...tipografia.subtitulo, color: colores.texto },
  bloqueCampo: { gap: espaciado.s },
  filaPaciente: { flexDirection: 'row', alignItems: 'center', gap: espaciado.m },
  flexible: { flex: 1 },
  escuchando: { ...tipografia.etiqueta, color: colores.error },
  glifoDictado: { fontSize: 14, color: colores.primario },
  botonDictado: {
    minHeight: AREA_TACTIL_MINIMA,
    minWidth: AREA_TACTIL_MINIMA,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.s,
    justifyContent: 'center',
    paddingHorizontal: espaciado.l,
    borderRadius: radios.m,
    borderWidth: 1,
    borderColor: colores.primario,
    backgroundColor: colores.superficie,
  },
  botonDictadoActivo: { backgroundColor: colores.primario },
  botonInactivo: { borderColor: colores.borde, backgroundColor: colores.deshabilitadoFondo },
  textoDictado: { ...tipografia.cuerpoDestacado, color: colores.primario },
  textoDictadoActivo: { color: colores.sobrePrimario },
  textoInactivo: { color: colores.deshabilitadoTexto },
  aviso: {
    padding: espaciado.m,
    borderRadius: radios.s,
    borderWidth: 1,
    borderColor: colores.advertencia,
    backgroundColor: colores.advertenciaFondo,
  },
  textoAviso: { ...tipografia.cuerpo, color: colores.advertencia },
  exito: {
    gap: espaciado.m,
    padding: espaciado.m,
    borderRadius: radios.s,
    borderWidth: 1,
    borderColor: colores.exito,
    backgroundColor: colores.exitoFondo,
  },
  textoExito: { ...tipografia.cuerpoDestacado, color: colores.exito },
});
