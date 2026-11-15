/** E1 — Acceso: inicio de sesión y pantalla de bloqueo. Ninguna muestra datos clínicos. */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { BotonPrimario, BotonSecundario, CampoTexto } from '../ui/componentes';
import { colores } from '../ui/tema';
import { MensajeError, Pantalla, Parrafo, Titulo } from './base';

interface PropsInicioSesion {
  readonly ocupada: boolean;
  readonly error: string | null;
  readonly alIniciarSesion: (email: string, password: string) => void;
}

export function E1Acceso({ ocupada, error, alIniciarSesion }: PropsInicioSesion) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Pantalla testID="pantalla-acceso">
      <Titulo>TO Clínica</Titulo>
      <Parrafo>Inicia sesión para abrir tu agenda.</Parrafo>
      <CampoTexto
        etiqueta="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        editable={!ocupada}
        testID="campo-email"
      />
      <CampoTexto
        etiqueta="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        editable={!ocupada}
        onSubmitEditing={() => alIniciarSesion(email, password)}
        testID="campo-password"
      />
      <MensajeError mensaje={error} />
      <BotonPrimario
        titulo="Iniciar sesión"
        onPress={() => alIniciarSesion(email, password)}
        cargando={ocupada}
        testID="boton-iniciar-sesion"
      />
    </Pantalla>
  );
}

interface PropsBloqueo {
  readonly ocupada: boolean;
  readonly error: string | null;
  readonly alDesbloquear: () => void;
  readonly alCerrarSesion: () => void;
}

export function PantallaBloqueo({ ocupada, error, alDesbloquear, alCerrarSesion }: PropsBloqueo) {
  // Al aparecer se pide la huella/rostro/PIN de inmediato; el botón queda como alternativa.
  useEffect(() => {
    alDesbloquear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Pantalla testID="pantalla-bloqueo">
      <Titulo>Aplicación bloqueada</Titulo>
      <Parrafo>Usa tu huella, tu rostro o el PIN del teléfono para continuar.</Parrafo>
      <MensajeError mensaje={error} />
      <BotonPrimario
        titulo="Desbloquear"
        onPress={alDesbloquear}
        cargando={ocupada}
        testID="boton-desbloquear"
      />
      <BotonSecundario
        titulo="Cerrar sesión"
        onPress={alCerrarSesion}
        deshabilitado={ocupada}
        testID="boton-cerrar-sesion"
      />
    </Pantalla>
  );
}

interface PropsRestauracion {
  readonly fallida: boolean;
  readonly ocupada: boolean;
  readonly error: string | null;
  readonly alReintentar: () => void;
  readonly alCerrarSesion: () => void;
}

export function PantallaRestauracion(props: PropsRestauracion) {
  return (
    <Pantalla testID="pantalla-restauracion">
      <Titulo>Restaurando tus datos</Titulo>
      {props.fallida ? (
        <>
          <MensajeError mensaje={props.error} />
          <BotonPrimario
            titulo="Reintentar"
            onPress={props.alReintentar}
            cargando={props.ocupada}
            testID="boton-reintentar-restauracion"
          />
          <BotonSecundario
            titulo="Cerrar sesión"
            onPress={props.alCerrarSesion}
            deshabilitado={props.ocupada}
          />
        </>
      ) : (
        <>
          <Parrafo>Estamos descargando tu información desde el servidor. No cierres la aplicación.</Parrafo>
          <ActivityIndicator
            size="large"
            color={colores.primario}
            accessibilityLabel="Restauración en curso"
          />
        </>
      )}
    </Pantalla>
  );
}

export function PantallaCarga({ error, alReintentar }: { error: string | null; alReintentar: () => void }) {
  return (
    <Pantalla testID="pantalla-carga">
      <Titulo>TO Clínica</Titulo>
      {error === null ? (
        <ActivityIndicator size="large" color={colores.primario} accessibilityLabel="Cargando" />
      ) : (
        <>
          <MensajeError mensaje={error} />
          <BotonPrimario titulo="Reintentar" onPress={alReintentar} />
        </>
      )}
    </Pantalla>
  );
}
