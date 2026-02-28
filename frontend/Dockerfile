# Use the lightweight Nginx Alpine image
FROM nginx:alpine

# Remove the default Nginx welcome page
RUN rm -rf /usr/share/nginx/html/*

# Copy your local frontend files (index.html, script.js, style.css) 
# into the folder Nginx uses to serve web content
COPY . /usr/share/nginx/html

# Expose port 80 (Standard HTTP)
EXPOSE 80

# Start Nginx in the foreground so the container doesn't exit
CMD ["nginx", "-g", "daemon off;"]