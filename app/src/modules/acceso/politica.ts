/**
 * Política de Privacidad mostrada en C1. Al cambiar el texto se debe subir
 * `VERSION_POLITICA`: la app volverá a exigir la aceptación (AUT-08).
 *
 * BORRADOR: el contenido debe ser revisado por la profesional responsable
 * (y, idealmente, asesoría legal) antes de publicar la app.
 */
export const VERSION_POLITICA = '1.0';

export interface SeccionPolitica {
  readonly titulo: string;
  readonly parrafos: readonly string[];
}

export const SECCIONES_POLITICA: readonly SeccionPolitica[] = [
  {
    titulo: '1. Qué es esta aplicación',
    parrafos: [
      'TO Clínica es una herramienta de uso profesional y personal para registrar la agenda y las sesiones de terapia ocupacional. Solo tú, como profesional tratante, tienes una cuenta.',
    ],
  },
  {
    titulo: '2. Qué datos se guardan',
    parrafos: [
      'Datos de identificación de pacientes y apoderados (nombre, fecha de nacimiento, teléfono) y datos sensibles de salud (antecedentes, motivo de consulta y registros de sesión), según las leyes chilenas N.º 19.628 y N.º 20.584.',
      'El dictado por voz se transcribe en el propio teléfono. La aplicación no guarda ni envía archivos de audio.',
    ],
  },
  {
    titulo: '3. Dónde se guardan y cómo se protegen',
    parrafos: [
      'Los datos se guardan cifrados en este teléfono y se respaldan, mediante conexión cifrada, en un servidor propio al que solo accede tu cuenta.',
      'La aplicación se bloquea con la huella, el rostro o el PIN del teléfono al abrirla, tras 5 minutos sin uso o tras 60 segundos en segundo plano.',
    ],
  },
  {
    titulo: '4. Conservación',
    parrafos: [
      'Las fichas clínicas no se eliminan: solo pueden archivarse, para cumplir el plazo mínimo de conservación de 15 años que exige la Ley N.º 20.584.',
    ],
  },
  {
    titulo: '5. Con quién se comparten',
    parrafos: [
      'Con nadie. No se usan servicios de inteligencia artificial en la nube ni se entregan datos a terceros. Los mensajes a apoderados se abren en WhatsApp sin incluir información clínica y eres tú quien decide enviarlos.',
    ],
  },
  {
    titulo: '6. Tu responsabilidad',
    parrafos: [
      'Como profesional eres responsable de contar con el consentimiento de pacientes o apoderados para registrar sus datos, de mantener el bloqueo de pantalla del teléfono activado y de no compartir tu contraseña.',
    ],
  },
];
