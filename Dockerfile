# Folosim Linux cu Node 20
FROM node:20-alpine

# Ne cream folderul de lucru
WORKDIR /app

# Copiem DOAR package.json din interiorul ludo-server
COPY package*.json ./

# Instalam pachetele de server
RUN npm install

# Copiem index.js si restul logicii
COPY . .

# Deschidem portul
EXPOSE 3001

# Comanda de pornire
CMD ["node", "index.js"]