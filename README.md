# Calculator Adaos Produse

Aplicație pentru calculul adaosului comercial și export în format Nexus.

## Deployment pe Server Contabo

### 1. Pregătire Server (prima dată)

```bash
# Conectare SSH la server
ssh root@IP_CONTABO

# Instalare Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalare PM2 (process manager)
sudo npm install -g pm2

# Instalare Nginx
sudo apt-get install -y nginx

# Creează directorul aplicației
sudo mkdir -p /var/www/adaos
sudo chown -R $USER:$USER /var/www/adaos
```

### 2. Configurare Nginx

```bash
sudo nano /etc/nginx/sites-available/adaos
```

Adaugă:
```nginx
server {
    listen 80;
    server_name adaos.domeniul-tau.ro;  # sau IP-ul serverului

    root /var/www/adaos/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache pentru assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Activează site-ul:
```bash
sudo ln -s /etc/nginx/sites-available/adaos /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Clone și Build

```bash
cd /var/www/adaos

# Prima dată - clone
git clone https://github.com/USERNAME/adaos-produse.git .

# Sau dacă există deja - pull
git pull origin main

# Instalare dependențe și build
npm install
npm run build
```

### 4. Script Auto-Deploy (GitHub Actions)

Creează `.github/workflows/deploy.yml` în repo:

```yaml
name: Deploy to Contabo

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install and Build
        run: |
          npm ci
          npm run build
          
      - name: Deploy to Server
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          source: "dist/*"
          target: "/var/www/adaos"
          strip_components: 0
```

### 5. Configurare GitHub Secrets

În repository GitHub → Settings → Secrets → Actions:
- `SERVER_HOST`: IP-ul serverului Contabo
- `SERVER_USER`: root (sau alt user)
- `SERVER_SSH_KEY`: Cheia SSH privată

### 6. Generare cheie SSH (dacă nu există)

```bash
# Pe calculatorul local
ssh-keygen -t ed25519 -C "github-deploy"

# Copiază cheia publică pe server
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@IP_CONTABO

# Cheia privată (~/.ssh/id_ed25519) o pui în GitHub Secrets
```

## Dezvoltare Locală

```bash
npm install
npm run dev
```

Deschide http://localhost:3000

## Build pentru Producție

```bash
npm run build
npm run preview  # testare locală
```

## Structură Proiect

```
adaos-app/
├── src/
│   ├── App.jsx          # Componenta principală
│   ├── main.jsx         # Entry point
│   └── index.css        # Stiluri Tailwind
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```
