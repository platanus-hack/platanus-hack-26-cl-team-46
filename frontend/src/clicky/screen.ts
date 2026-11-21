// "Ver tu pantalla": captura de la pestaña actual con getDisplayMedia({ preferCurrentTab }).
// Se pide una vez al activar Clicky (necesita el clic del usuario) y queda abierta mientras está activo;
// en cada pregunta se toma un cuadro, se achica y se manda como JPEG. Si el usuario no comparte,
// Clicky sigue funcionando solo con el texto de la página.

export interface TabCapture {
  grab(): Promise<string | null>;
  stop(): void;
}

const MAX_WIDTH = 1440;

export async function startTabCapture(onEnded: () => void): Promise<TabCapture | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: { ideal: 5, max: 10 } },
      audio: false,
      // Chrome: ofrece esta pestaña primero y no deja saltar a otra. Otros navegadores lo ignoran.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions);
  } catch {
    return null; // el usuario canceló o el navegador no deja
  }

  const [track] = stream.getVideoTracks();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  let stopped = false;
  track.addEventListener("ended", () => {
    stopped = true;
    onEnded();
  });

  // Espera un cuadro nuevo (la página acaba de borrar los dibujos); si la pestaña está quieta no llegan cuadros.
  const nextFrame = () =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 350);
      video.requestVideoFrameCallback?.(() => {
        clearTimeout(t);
        resolve();
      });
    });

  return {
    async grab() {
      if (stopped || track.readyState !== "live") return null;
      await nextFrame();
      if (!video.videoWidth) return null;
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.72);
    },
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
