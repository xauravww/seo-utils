FROM node:20-slim

WORKDIR /app

# Install npm (already present in base image, but good to ensure)
# This line is commented out as npm is typically pre-installed
# RUN npm install -g npm 

# Copy package.json and package-lock.json to leverage Docker cache
# COMMENTED OUT THE PREVIOUS INCORRECT LINE BELOW
# COPY package.json pnpm-lock.yaml ./ # Original incorrect line
COPY package.json package-lock.json ./ 

# Install Node.js dependencies
RUN npm ci --production

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

# Copy the application code
COPY . .

# Command to run the script
CMD ["node", "index.js"]