FROM node:20-alpine

WORKDIR /app

# Copy all files
COPY . .

# Install all dependencies (including dev)
RUN npm install

# Build the app
RUN npm run build

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]