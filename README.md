# MacRunner

Sistema de orquestación de tareas para ejecutar y gestionar proyectos Python en máquinas Mac. Incluye interfaz web interactiva con terminal integrada, monitoreo de recursos en tiempo real y streaming de logs.

## Requisitos del Sistema

### Software necesario

| Componente | Versión mínima | Notas |
|------------|----------------|-------|
| **macOS** | 10.15+ | También compatible con Linux/Windows |
| **Node.js** | 14.0+ | npm incluido |
| **Python** | 3.8+ | pip incluido |
| **Git** | 2.0+ | Para clonar repositorios |

### Puertos requeridos

- `5173` - Frontend (servidor de desarrollo)
- `8000` - Backend (API REST + WebSocket)

### Recursos recomendados

- **RAM**: 2GB mínimo (4GB recomendado)
- **Disco**: 2GB libres para dependencias y workspaces

## Instalación

### 1. Clonar el repositorio

```bash
git clone <url-del-repositorio>
cd mac-runner
```

### 2. Configurar el Backend

```bash
cd backend

# Crear entorno virtual
python3 -m venv venv

# Activar entorno virtual
source venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt
```

### 3. Configurar el Frontend

```bash
cd frontend

# Instalar dependencias
npm install
```

## Ejecución

### Opción 1: Usando los scripts de inicio (recomendado)

Abre dos terminales separadas:

**Terminal 1 - Backend:**
```bash
./start-backend.sh
```

**Terminal 2 - Frontend:**
```bash
./start-frontend.sh
```

### Opción 2: Ejecución manual

**Terminal 1 - Backend:**
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

### Acceder a la aplicación

Una vez iniciados ambos servicios:

- **Interfaz web local**: http://localhost:5173
- **API Backend**: http://localhost:8000
- **Documentación API**: http://localhost:8000/docs

## Estructura del Proyecto

```
mac-runner/
├── frontend/                   # Aplicación React
│   ├── src/
│   │   ├── components/        # Componentes UI
│   │   ├── contexts/          # React Contexts
│   │   ├── hooks/             # Custom hooks
│   │   ├── pages/             # Páginas principales
│   │   ├── App.jsx            # Componente raíz
│   │   └── api.js             # Cliente API
│   ├── package.json
│   └── vite.config.js
│
├── backend/                    # API FastAPI
│   ├── app/
│   │   ├── main.py            # Endpoints REST y WebSocket
│   │   ├── manager.py         # Gestor de procesos
│   │   ├── models.py          # Modelos de datos
│   │   ├── database.py        # Configuración SQLite
│   │   └── websockets.py      # Handlers WebSocket
│   ├── requirements.txt
│   ├── workspaces/            # Repositorios clonados
│   └── logs/                  # Logs de ejecuciones
│
├── start-backend.sh           # Script inicio backend
├── start-frontend.sh          # Script inicio frontend
└── README.md
```

## Funcionalidades

### Dashboard de Proyectos
- Crear proyectos desde URLs de GitHub
- Ver estado de todos los proyectos
- Monitorear recursos del sistema (CPU, RAM)

### Gestión de Proyectos
- Clonar repositorios automáticamente
- Configurar comandos de instalación y ejecución
- Guardar templates de comandos reutilizables
- Editar variables de entorno

### Terminal Web
- Terminal interactiva integrada (xterm.js)
- Ejecutar comandos en el workspace del proyecto
- Historial de comandos persistente

### Monitoreo
- Streaming de logs en tiempo real
- Estado de ejecución de trabajos
- Monitor de recursos del sistema

### Notebooks
- Soporte para Jupyter Notebooks
- Ejecución con Papermill
- Conversión de notebooks

## Tecnologías

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS
- xterm.js (terminal web)
- React Router v6

### Backend
- FastAPI
- SQLModel + SQLite
- WebSockets
- psutil (monitoreo)
- Papermill (notebooks)

## Configuración Adicional

### Variables de Entorno

Puedes crear un archivo `.env` en la raíz del backend para configuración personalizada:

```env
# Ejemplo de configuración
DATABASE_URL=sqlite:///./macrunner.db
```

### Acceso en Red Local

El backend está configurado para escuchar en `0.0.0.0`, permitiendo acceso desde otros dispositivos en tu red local. Usa la IP de tu Mac seguida del puerto 5173.

### Acceso Remoto con Tailscale

Para acceder a MacRunner desde fuera de tu red local, es necesario usar [Tailscale](https://tailscale.com/).

#### Instalación de Tailscale

1. Descarga e instala Tailscale desde https://tailscale.com/download
2. Inicia sesión con tu cuenta
3. Asegúrate de que tanto el servidor (Mac donde corre MacRunner) como el cliente (dispositivo desde donde quieres acceder) estén conectados a la misma red Tailscale

#### Configuración

MacRunner detecta automáticamente si tienes Tailscale configurado y mostrará las URLs de acceso correspondientes en la interfaz.

Una vez configurado, podrás acceder desde cualquier lugar usando la URL de Tailscale:
```
http://<nombre-de-tu-mac>.tailnet-xxxx.ts.net:5173
```

#### Ventajas de Tailscale
- Conexión segura cifrada de extremo a extremo
- No requiere abrir puertos en el router
- Funciona a través de NAT y firewalls
- Sin necesidad de configurar VPN tradicional

## Solución de Problemas

### El backend no inicia

1. Verifica que Python 3.8+ está instalado:
   ```bash
   python3 --version
   ```

2. Asegúrate de que el puerto 8000 está libre:
   ```bash
   lsof -i :8000
   ```

3. Verifica las dependencias:
   ```bash
   cd backend
   source venv/bin/activate
   pip install -r requirements.txt
   ```

### El frontend no inicia

1. Verifica que Node.js 14+ está instalado:
   ```bash
   node --version
   ```

2. Asegúrate de que el puerto 5173 está libre:
   ```bash
   lsof -i :5173
   ```

3. Reinstala las dependencias:
   ```bash
   cd frontend
   rm -rf node_modules
   npm install
   ```

### La conexión WebSocket falla

1. Verifica que el backend está corriendo en el puerto 8000
2. Comprueba que no hay firewalls bloqueando las conexiones
3. Revisa la consola del navegador para errores específicos

### Error al clonar repositorios

1. Verifica que Git está instalado y configurado
2. Para repositorios privados, asegúrate de tener las credenciales configuradas
3. Comprueba la conectividad a GitHub

## Desarrollo

### Frontend en modo desarrollo

```bash
cd frontend
npm run dev
```

El servidor de desarrollo incluye hot reload automático.

### Backend en modo desarrollo

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --reload-dir app
```

El flag `--reload` activa la recarga automática al modificar archivos.

### Build de producción (Frontend)

```bash
cd frontend
npm run build
```

Los archivos compilados se generarán en `frontend/dist/`.

## Licencia

MIT License
