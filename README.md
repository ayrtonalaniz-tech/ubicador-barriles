# Ubicador de Barriles

App web instalable (Android y Windows) para saber en qué cervecería está cada barril y qué cerveza tiene. Cada barril lleva un QR pegado: al escanearlo se abre su ficha, sin necesidad de cuenta. Para dar de alta barriles y registrar movimientos hay que ingresar con usuario y contraseña.

- **App:** archivos estáticos publicados en GitHub Pages (gratis).
- **Datos:** Supabase (plan gratuito).
- La ubicación y la cerveza se guardan siempre en MAYÚSCULAS, así "terraza" y "Terraza" son el mismo lugar.

---

## 1. Crear la base de datos (Supabase) — una sola vez

1. Entrá a <https://supabase.com>, creá una cuenta y un proyecto nuevo (región: São Paulo).
2. En el menú **SQL Editor → New query**, pegá todo el contenido de `supabase/schema.sql` y tocá **Run**. Esto crea las tablas, los permisos y carga los barriles 50-001 y 50-002.
3. En **Authentication → Users → Add user → Create new user**, creá un usuario (email y contraseña) para cada persona que va a registrar movimientos. Marcá *Auto Confirm User*.
4. En **Authentication → Sign In / Providers**, desactivá **Allow new users to sign up**, para que nadie pueda crearse una cuenta por su cuenta.
5. En **Project Settings → API** copiá el **Project URL** y la **anon public key**.

## 2. Conectar la app con la base

Abrí `config.js` y reemplazá los dos valores:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

La *anon key* es pública por diseño: lo que cada uno puede hacer lo controlan los permisos de la base (cualquiera ve, solo usuarios ingresados cargan).

## 3. Publicar en GitHub Pages

1. Subí todos los archivos de esta carpeta a la raíz del repositorio (rama `main`).
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`, **Save**.
3. A los uno o dos minutos la app queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

## 4. Instalar la app

- **Android:** abrí la dirección en Chrome → menú ⋮ → **Instalar app** (o **Agregar a pantalla principal**).
- **Windows:** abrí la dirección en Edge o Chrome → ícono de instalar en la barra de direcciones (o el botón **Instalar app** dentro de la página).

Queda con su ícono, abre en ventana propia y se actualiza sola cada vez que se cambia el código en GitHub.

## 5. Etiquetas QR

Ingresá → **Etiquetas QR** → marcá cuáles querés (o ninguna para todas) → **Imprimir**. Salen 12 por hoja A4. Cada QR apunta a `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/?b=CODIGO`.

> Si cambiás el nombre del repositorio o el dominio, los QR ya impresos dejan de funcionar: elegí el nombre definitivo antes de imprimir.

## Estructura

| Archivo | Para qué |
|---|---|
| `index.html` | La pantalla de la app |
| `styles.css` | Diseño (incluye el formato de impresión de etiquetas) |
| `app.js` | Lógica: listado, ficha, movimientos, ingreso, QR |
| `config.js` | Datos de conexión a Supabase |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo que la hace instalable |
| `supabase/schema.sql` | Tablas, permisos y datos iniciales |

---

## Versión sin internet (`/local/`)

En `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/local/` hay una versión que **no usa internet ni cuentas**: los barriles se guardan solo en el dispositivo donde se instala. Pensada para un cliente que quiere su app propia en un único dispositivo.

- Se necesita internet **solo para instalarla** la primera vez; después abre y funciona sin conexión (las fuentes y el lector de QR van incluidos).
- **Ajustes → Copia de seguridad** descarga un archivo `.json` con todo; **Restaurar** lo vuelve a cargar. Si se pierde el dispositivo sin copia, se pierden los datos.
- La app avisa si pasaron más de 7 días sin copia.
- Los QR de esta versión se leen con el botón **Escanear** de la app.
- No comparte nada con la versión con Supabase.
- **Usuarios locales:** al abrir pide **Ingresar** o **Crear usuario**. Cada usuario ve y mueve solo sus barriles, con su propio nombre de cervecería y sus copias. La contraseña se guarda cifrada (PBKDF2) y no se puede recuperar si se olvida; con una copia de seguridad se restauran los barriles en un usuario nuevo. Es una separación dentro de la app, no un cifrado de los datos del dispositivo.
