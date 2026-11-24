# Pose Tracker → vMix

PWA que usa la cámara del móvil para **detectar y rastrear personas (pose corporal)** en tiempo real, dibuja esqueleto, ID y métricas sobre un canvas transparente y genera **un enlace** que se pega en vMix como fuente **Web Browser**.

- Procesamiento **100 % local** en el móvil (MediaPipe Pose Landmarker en un Web Worker). Ningún fotograma se sube a servidores.
- 15–30 FPS con **resolución de inferencia adaptable**.
- **Encuadre automático** (zoom digital que sigue a la persona): primer plano, medio cuerpo o cuerpo completo.
- Seguimiento multi-persona con **IDs estables**, suavizado One Euro y métricas: velocidad, dirección, tiempo en pantalla y manos levantadas.
- Tres salidas por enlace: **video con overlay**, **solo overlay transparente** y **video limpio**.
- Se despliega como sitio estático (GitHub Pages / Netlify). Sin backend propio.

> **Sobre NDI / cámara virtual:** un navegador no puede emitir NDI ni registrar una cámara virtual. Por eso la salida es un enlace WebRTC que vMix abre con su fuente *Web Browser* (que es un Chromium). Es lo que pediste: "una página que emita un link para pegarlo en vMix". Si algún día necesitas NDI real, vMix puede reemitir esa fuente por NDI desde *Output/NDI*.

---

## 1. Inicio rápido

```bash
npm install        # instala dependencias, copia el WASM y descarga el modelo (~6 MB)
npm run dev        # servidor HTTPS local (certificado autofirmado) para probar en el móvil
npm test           # pruebas unitarias
npm run build      # genera dist/
```

`npm run dev` imprime una dirección `https://192.168.x.x:5173/`. Ábrela en el móvil (misma Wi-Fi), acepta el aviso del certificado autofirmado y toca **Iniciar cámara**.

Si `npm install` no pudo descargar el modelo (red restringida), baja el archivo a mano y guárdalo como `public/models/pose_landmarker_lite.task`:

```
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task
```

`npm run build` se detiene con un error claro si falta el modelo, para no publicar una app rota.

---

## 2. Cómo usarlo con vMix

1. En el **móvil**, abre la app (la URL desplegada), toca **Iniciar cámara** y acepta el permiso.
2. Toca **Enlace vMix**. Verás tres URLs; copia la que quieras:

   | Modo | Qué recibe vMix | Cuándo usarlo |
   |---|---|---|
   | **Video con overlay** (`mode=video`) | Cámara + esqueleto + IDs ya compuestos | Lo más simple: una sola fuente |
   | **Solo overlay** (`mode=overlay`) | Gráficos con **fondo transparente** | Superponerlos sobre otra cámara (misma proporción 16:9) |
   | **Video limpio** (`mode=raw`) | Cámara sin gráficos | Cuando solo quieres la imagen |

3. En **vMix** (en el PC): **Add Input → Web Browser**, pega la URL y ajusta el tamaño a **1280×720** (o el del emisor).
4. Para el modo *overlay*: añade esa fuente como **capa** sobre otra entrada. El fondo es transparente.
5. Deja la app del móvil **abierta y con la pantalla encendida** mientras transmites (usa *Wake Lock*, pero iOS/Android pueden pausar la cámara si la app pasa a segundo plano).

### Parámetros opcionales de la URL del receptor

| Parámetro | Valores | Efecto |
|---|---|---|
| `fit` | `contain` (def.), `cover`, `stretch` | Cómo se ajusta la imagen al tamaño de la fuente |
| `bg` | `transparent`, o hex sin `#` (`00ff00`) | Color de fondo (croma, p. ej.) |
| `skeleton`, `points`, `ids`, `metrics`, `bbox` | `0` / `1` | Qué dibujar (solo modo *overlay*) |
| `crop` | `0` | Solo modo *overlay*: ignora el encuadre automático (úsalo si la capa va sobre una cámara sin recortar) |
| `debug` | `1` | Muestra el estado de la conexión sobre la imagen |

Ejemplo: `…/receiver.html?id=vpt-xxxx&mode=overlay&ids=0&bbox=1`

### Encuadre automático (zoom)

En el móvil: **Ajustes → Encuadre automático**.

| Opción | Qué encuadra |
|---|---|
| Desactivado | Imagen completa de la cámara |
| Primer plano | Cabeza y hombros |
| Medio cuerpo | Cabeza a cintura |
| Cuerpo completo | De la cabeza a los pies |

- Es **zoom digital**: recorta y amplía la imagen, así que pierde algo de nitidez. Usa la cámara en **1080p** (Ajustes → Resolución de cámara) y el video emitido en 720p o 1080p.
- La detección sigue usando la imagen completa; solo cambia lo que se emite.
- El movimiento del recorte es suave y, si pierde a la persona, mantiene el plano 2 segundos y vuelve a la imagen completa.
- Con **varias personas** encuadra a todas juntas.
- En la pantalla del móvil ves la **imagen completa** con un recuadro punteado: eso es lo que recibe vMix.
- Se aplica a los tres enlaces. En el modo *overlay* los gráficos siguen el recorte; si los superpones a una cámara que no está recortada, añade `&crop=0` a la URL.
- Límite: el zoom máximo es 4×. Si la persona está muy lejos, el plano cerrado no llegará a ser tan cerrado.

### Requisitos de red

- Móvil y PC con vMix en la **misma red local** (Wi-Fi 5 GHz o, mejor, el PC por cable). Es el escenario por defecto y el de menor latencia.
- Si están en redes distintas, activa **Ajustes → Red → STUN** en el móvil y **vuelve a copiar los enlaces** (llevan `stun=1`). Aun así, no se usa ningún servidor de relé (TURN): si el router bloquea la conexión directa, no conectará. Consulta la sección de privacidad.
- El PC con vMix necesita internet solo para la **señalización** inicial (ver más abajo), no para el video.

---

## 3. Despliegue a producción

La app necesita **HTTPS** para acceder a la cámara. Ambas opciones lo dan gratis.

### Opción A · GitHub Pages (workflow incluido)

1. Crea un repo en GitHub y sube **todo el contenido de esta carpeta** (incluido `.github/`):
   ```bash
   git init && git add . && git commit -m "Primera versión"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. El workflow `deploy.yml` instala, comprueba tipos, ejecuta las pruebas, compila y publica. La app queda en `https://TU_USUARIO.github.io/TU_REPO/`.

El proyecto usa rutas relativas (`base: './'`), así que funciona en esa subcarpeta sin configurar nada.

### Opción B · Netlify

1. **Add new site → Import from Git** y elige el repo.
2. `netlify.toml` ya define el comando (`npm run build`), la carpeta (`dist`) y Node 22. No cambies nada.
3. Para un arrastrar-y-soltar manual: ejecuta `npm run build` y sube la carpeta `dist/` en *Deploys → Drag and drop*.

### Después de desplegar

- Abre la URL en el móvil → **Compartir → Añadir a pantalla de inicio** (iPhone) o menú ⋮ → **Instalar app** (Android). Funciona a pantalla completa y, tras la primera carga, **sin conexión** (modelo y WASM se guardan en caché por el service worker).
- Para publicar una versión nueva y forzar que los móviles refresquen la caché, sube `CACHE_VERSION` en `public/sw.js`.

---

## 4. Privacidad y seguridad

| Qué | Dónde ocurre |
|---|---|
| Inferencia de pose, tracking, dibujo | En el móvil (Web Worker). Nunca sale del dispositivo. |
| Modelo de IA y WASM | Se sirven desde **tu propio sitio** (`/models`, `/wasm`). Sin CDN ni terceros. |
| Video hacia vMix | **WebRTC punto a punto**, cifrado (DTLS-SRTP), directo móvil → PC. |
| Señalización | Solo SDP/ICE (direcciones de red e ID del enlace). **No incluye imagen.** |

Detalles importantes:

- **Sin servidores de relé.** PeerJS trae por defecto STUN y TURN públicos. Esta app los **elimina**: por defecto `iceServers` está vacío, así el video solo puede viajar directo en la LAN. Con la opción STUN se añade únicamente STUN (descubrir tu IP pública), nunca TURN.
- **Señalización por PeerJS Cloud (gratuito, por defecto).** Ve el ID del enlace y las direcciones IP/candidatos ICE de ambos extremos. Si eso no es aceptable, monta tu propio servidor ([peerjs-server](https://github.com/peers/peerjs-server)) y arranca la app del móvil una vez con `?peerHost=tu.dominio&peerPort=443&peerPath=/&peerSecure=1`; se guarda en el dispositivo y los enlaces generados lo incluyen.
- **El enlace es la llave.** El ID es aleatorio (~59 bits), pero quien tenga la URL del receptor puede conectarse a tu cámara mientras la app esté abierta. No lo publiques; usa **Generar enlace nuevo** si se compartió por error.
- Los permisos de cámara se limitan al propio origen (`Permissions-Policy` en `netlify.toml`).

---

## 5. Rendimiento

- La inferencia se hace sobre una copia reducida del frame (256–640 px de lado largo). El controlador adaptativo **baja un escalón** si el tiempo captura→resultado supera el presupuesto del FPS objetivo y **sube** tras un rato con margen (con histéresis para no oscilar). Se ve en la barra superior (`IA 384px GPU`).
- Hay **una sola inferencia en vuelo** (contrapresión): si el dispositivo no da abasto, se omiten frames en lugar de acumular retraso.
- El video emitido y la IA van **desacoplados**: la imagen sale a la cadencia de la cámara (hasta 30 fps) aunque el tracking vaya a 15. Los esqueletos se suavizan con One Euro.
- Consejos: modo horizontal, buena luz, cámara trasera, **2 personas** como máximo si el móvil es modest, y 720p de cámara.
- Si la GPU falla (algunos iPhone/Android en workers), la app cae sola a CPU; la barra lo indica.

---

## 6. Estructura

Consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para el detalle.

```
├── index.html            App del móvil (emisor)
├── receiver.html         Página que carga vMix
├── src/
│   ├── core/             Lógica pura y testeable (tracker, métricas, protocolo, render…)
│   ├── workers/          Web Worker de MediaPipe
│   ├── sender/           Cámara, motor de IA, compositor, hub WebRTC, UI
│   └── receiver/         Cliente para vMix
├── public/               manifest, service worker, iconos, modelo y WASM
├── scripts/              Preparación de recursos (WASM + modelo)
├── tests/                Vitest
├── .github/workflows/    Despliegue a GitHub Pages
└── netlify.toml          Despliegue a Netlify
```

---

## 7. Solución de problemas

| Síntoma | Causa probable y solución |
|---|---|
| "La cámara solo funciona en HTTPS" | Abriste la app por `http://`. Usa la URL desplegada o `npm run dev` (HTTPS). |
| Permiso denegado | Ajustes del navegador → Permisos del sitio → Cámara → Permitir. |
| vMix muestra negro / "Esperando al emisor" | La app del móvil debe estar abierta y en primer plano; copia de nuevo el enlace; añade `&debug=1` para ver el estado. |
| Se conecta por LAN pero no por internet | Es lo esperado sin TURN. Activa STUN o usa la misma red. |
| "Ese enlace ya está en uso" | La app está abierta en otra pestaña/dispositivo con el mismo ID. Ciérrala o genera un enlace nuevo. |
| `Error del motor de IA` al iniciar | Falta `public/models/pose_landmarker_lite.task` o `public/wasm/`. Ejecuta `npm run fetch:assets`. |
| FPS bajos | Baja "Personas a rastrear", "FPS objetivo" o la resolución de cámara. |
| El overlay aparece desfasado del video | Usa el modo *Video con overlay*, que sincroniza ambos; el modo *overlay* sobre otra cámara depende de que sea la misma proporción. |

---

## 8. Licencias

Código del proyecto: MIT. MediaPipe Tasks Vision y el modelo Pose Landmarker: Apache 2.0 (Google). PeerJS: MIT.
