FROM node:20

WORKDIR /app

# зависимости
COPY package*.json ./
RUN npm install

# код
COPY . .

# билд
RUN npm run build

# запуск
CMD ["npm", "run", "start"]