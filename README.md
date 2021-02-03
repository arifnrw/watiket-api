# WA Tiket - API

Sistem Tiket _sangat sederhana_ berdasarkan pesan WhatsApp.

Backend menggunakan [whatsapp-web.js] (https://github.com/pedroslopez/whatsapp-web.js) untuk menerima dan mengirim pesan WhatsApp, membuat tiket darinya, dan menyimpan semuanya dalam database MySQL.

Frontend adalah multi-user _chat app_ bootstrapped berfitur lengkap dengan react-create-app dan Material UI, yang berkomunikasi dengan backend menggunakan REST API dan Websockets. Ini memungkinkan Anda untuk berinteraksi dengan kontak, tiket, mengirim dan menerima pesan WhatsApp.

** CATATAN **: Saya tidak dapat menjamin Anda tidak akan diblokir dengan menggunakan metode ini, meskipun itu berhasil untuk saya. WhatsApp tidak mengizinkan bot atau klien tidak resmi di platform mereka, jadi ini tidak boleh dianggap sepenuhnya aman.

## Motivasi

Saya seorang SysAdmin, dan dalam pekerjaan saya sehari-hari, saya melakukan banyak dukungan melalui WhatsApp. Karena WhatsApp Web tidak mengizinkan banyak pengguna, dan 90% tiket kami berasal dari saluran ini, kami membuat ini untuk berbagi akun whatsapp yang sama di seluruh tim kami.

## Bagaimana itu bekerja?

Pada setiap pesan baru yang diterima di WhatsApp terkait, Tiket baru dibuat. Kemudian, tiket ini dapat dihubungi di _queue_ di halaman _Tickets_, di mana Anda dapat menetapkan tiket ke diri Anda sendiri dengan _aceppting_, merespons pesan tiket dan akhirnya _menyelesaikannya.

Pesan berikutnya dari kontak yang sama akan terkait dengan tiket ** terbuka / tertunda ** pertama yang ditemukan.

Jika kontak mengirim pesan baru dalam interval kurang dari 2 jam, dan tidak ada tiket dari kontak ini dengan status ** tertunda / buka **, tiket terbaru ** ditutup ** akan dibuka kembali, bukan membuat yang baru .

## Fitur

- Minta banyak pengguna mengobrol di Nomor WhatsApp yang sama ✅
- Hubungkan ke beberapa akun WhatsApp dan terima semua pesan di satu tempat ✅ 🆕
- Buat dan mengobrol dengan kontak baru tanpa menyentuh ponsel ✅
- Mengirim dan menerima pesan ✅
- Kirim media (gambar / audio / dokumen) ✅
- Terima media (gambar / audio / video / dokumen) ✅

## Demo

** Catatan **: Bukan ide yang baik untuk menyinkronkan akun WhatsApp Anda di lingkungan demo ini, karena semua pesan yang Anda terima akan disimpan dalam database dan dapat diakses oleh semua orang yang mengakses URL ini dan membuat akun.

Meskipun demikian, tidak banyak yang bisa diuji tanpa menyinkronkan akun WhatsApp, karena menambahkan kontak atau tiket akan membuat kesalahan jika aplikasi tidak disinkronkan dengan WhatsApp.

Sementara itu, jika Anda ingin mengujinya, ingatlah untuk memutuskan sesi dan menghapus semua tiket dan kontak setelah pengujian Anda.

https://tiket.ruangwa.com

email: demo1@gmail.com

kata sandi: 12345678

## Basic production deployment (Ubuntu 18.04 VPS)

All instructions below assumes you are NOT running as root, since it will give an error in puppeteer. So let's start creating a new user and granting sudo privileges to it:

```bash
adduser deploy
usermod -aG sudo deploy
```

Now we can login with this new user:

```bash
su deploy
```

You'll need two subdomains forwarding to yours VPS ip to follow these instructions. We'll use `myapp.mydomain.com` to frontend and `api.mydomain.com` to backend in the following example.

Update all system packages:

```bash
sudo apt update && sudo apt upgrade
```

Install node and confirm node command is available:

```bash
curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

Install docker and add you user to docker group:

```bash
sudo apt install apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu bionic stable"
sudo apt update
sudo apt install docker-ce
sudo systemctl status docker
sudo usermod -aG docker ${USER}
su - ${USER}
```

Create Mysql Database using docker:
_Note_: change MYSQL_DATABASE, MYSQL_PASSWORD, MYSQL_USER and MYSQL_ROOT_PASSWORD.

```bash
docker run --name watiketdb -e MYSQL_ROOT_PASSWORD=strongpassword -e MYSQL_DATABASE=watiket -e MYSQL_USER=watiket -e MYSQL_PASSWORD=watiket --restart always -p 3306:3306 -d mariadb:latest --character-set-server=utf8mb4 --collation-server=utf8mb4_bin
```

Clone this repository:

```bash
cd ~
git clone https://github.com/myfrizqi/watiket watiket
```

Create backend .env file and fill with details:

```bash
cp watiket/backend/.env.example watiket/backend/.env
nano watiket/backend/.env
```

```bash
NODE_ENV=
BACKEND_URL=https://api.mydomain.com      #USE HTTPS HERE, WE WILL ADD SSL LATTER
FRONTEND_URL=https://myapp.mydomain.com   #USE HTTPS HERE, WE WILL ADD SSL LATTER, CORS RELATED!
PROXY_PORT=443                            #USE NGINX REVERSE PROXY PORT HERE, WE WILL CONFIGURE IT LATTER
PORT=8080

DB_HOST=localhost
DB_DIALECT=
DB_USER=
DB_PASS=
DB_NAME=

JWT_SECRET=3123123213123
JWT_REFRESH_SECRET=75756756756
```

Install puppeteer dependencies:

```bash
sudo apt-get install -y libgbm-dev wget unzip fontconfig locales gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils
```

Install backend dependencies, build app, run migrations and seeds:

```bash
cd watiket/backend
npm install
npm run build
npx sequelize db:migrate
npx sequelize db:seed:all
```

Start it with `npm start`, you should see: `Server started on port...` on console. Hit `CTRL + C` to exit.

Install pm2 **with sudo**, and start backend with it:

```bash
sudo npm install -g pm2
pm2 start dist/server.js --name watiket-backend
```

Make pm2 auto start afeter reboot:

```bash
pm2 startup ubuntu -u `YOUR_USERNAME`
```

Copy the last line outputed from previus command and run it, its something like:

```bash
sudo env PATH=\$PATH:/usr/bin pm2 startup ubuntu -u YOUR_USERNAME --hp /home/YOUR_USERNAM
```

Go to frontend folder and install dependencies:

```bash
cd ../frontend
npm install
```

Edit .env file and fill it with your backend address, it should look like this:

```bash
REACT_APP_BACKEND_URL = https://api.mydomain.com/
```

Build frontend app:

```bash
npm run build
```

Start frontend with pm2, and save pm2 process list to start automatically after reboot:

```bash
pm2 start server.js --name watiket-frontend
pm2 save
```

To check if it's running, run `pm2 list`, it should look like:

```bash
deploy@ubuntu-whats:~$ pm2 list
┌─────┬─────────────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id  │ name                    │ namespace   │ version │ mode    │ pid      │ uptime │ .    │ status    │ cpu      │ mem      │ user     │ watching │
├─────┼─────────────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 1   │ watiket-frontend      │ default     │ 0.1.0   │ fork    │ 179249   │ 12D    │ 0    │ online    │ 0.3%     │ 50.2mb   │ deploy   │ disabled │
│ 6   │ watiket-backend       │ default     │ 1.0.0   │ fork    │ 179253   │ 12D    │ 15   │ online    │ 0.3%     │ 118.5mb  │ deploy   │ disabled │
└─────┴─────────────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘

```

Install nginx:

```bash
sudo apt install nginx
```

Remove nginx default site:

```bash
sudo rm /etc/nginx/sites-enabled/default
```

Create a new nginx site to frontend app:

```bash
sudo nano /etc/nginx/sites-available/watiket-frontend
```

Edit and fill it with this information, changing `server_name` to yours equivalent to `myapp.mydomain.com`:

```bash
server {
  server_name myapp.mydomain.com;

  location / {
    proxy_pass http://127.0.0.1:3333;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;
  }
}
```

Create another one to backend api, changing `server_name` to yours equivalent to `api.mydomain.com`, and `proxy_pass` to your localhost backend node server URL:

```bash
sudo cp /etc/nginx/sites-available/watiket-frontend /etc/nginx/sites-available/watiket-backend
sudo nano /etc/nginx/sites-available/watiket-backend
```

```bash
server {
  server_name api.mydomain.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    ......
}
```

Create a symbolic links to enalbe nginx sites:

```bash
sudo ln -s /etc/nginx/sites-available/watiket-frontend /etc/nginx/sites-enabled
sudo ln -s /etc/nginx/sites-available/watiket-backend /etc/nginx/sites-enabled
```

By default, nginx limit body size to 1MB, what isn't enough to some media uploads. Lets change it to 20MB adding a new line to config file:

```bash
sudo nano /etc/nginx/nginx.conf
...
http {
    ...
    client_max_body_size 20M; # HANDLE BIGGER UPLOADS
}
```

Test nginx configuration and restart server:

```bash
sudo nginx -t
sudo service nginx restart
```

Now, enable SSL (https) on your sites to use all app features like notifications and sending audio messages. A easy way to this is using Certbot:

Install certbor with snapd:

```bash
sudo snap install --classic certbot
```

Enable SSL on nginx (Accept all information asked):

```bash
sudo certbot --nginx
```

## Berkontribusi

Setiap bantuan dan saran dipersilakan!

## Disclaimer

Saya baru saja mulai mempelajari Javascript beberapa bulan yang lalu dan ini adalah proyek pertama saya. Ini mungkin memiliki masalah keamanan dan banyak bug. Saya sarankan menggunakannya hanya di jaringan lokal.

Proyek ini tidak berafiliasi, terkait, diizinkan, didukung oleh, atau dengan cara apa pun secara resmi terhubung dengan WhatsApp atau salah satu anak perusahaannya atau afiliasinya. Situs web resmi WhatsApp dapat ditemukan di https://whatsapp.com. "WhatsApp" serta nama, merek, lambang, dan gambar terkait adalah merek dagang terdaftar dari pemiliknya masing-masing.
# myfrizqi
