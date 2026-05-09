# Building a Docker Image with Ollama Models

This guide explains how to build and run a custom Docker image for Ollama with
pre-pulled models, using the provided `FreelensOllamaImage` Dockerfile and
Docker Compose setup.

## 1. Dockerfile Overview

The `FreelensOllamaImage` Dockerfile is designed to:

- Start the Ollama server in the background
- Pull one or more models specified by the `MODELS` build argument
- Stop the server after pulling the models

## 2. Build and run ollama image

You can specify which models to pull by setting the `MODELS` build argument.
For example, to pull both `llama3.2:1b` and `mistral:7b`:

```sh
cd docker
docker build -f FreelensOllamaImage -t freelens-ollama --build-arg MODELS="llama3.2:1b mistral:7b" .

# Create the named volume if it doesn't exist
docker volume create ollama

# Run the container
docker run -d --name freelens-ollama -p 9898:11434 -v ollama:/root/.ollama -e OLLAMA_ORIGINS=* -e OLLAMA_KEEP_ALIVE=24h --restart unless-stopped freelens-ollama
```

## 3. Using Docker Compose

The provided `freelens-ollama-compose.yml` file builds the image and runs the
container:

1. It reads the dockerfile `FreelensOllamaImage` and builds the image
2. It uses the produced image to start a container
3. It configures the container by adding some environment variables and other
   configurations

### Build and Run

To build and start the service with Docker Compose:

```sh
cd docker
docker-compose -f .\freelens-ollama-compose.yml up -d
```

Currently the supported Ollama models are llama3.2-1b and mistral:7b, if you
only want to pull one of those models simply edit the MODELS build argument
into the `FreelensOllamaImage` and specify only the modelname to pull.

---

**Summary:**

- Edit the `MODELS` build argument to control which models are pre-pulled.
- Use Docker Compose for easy build and deployment.
- Models are stored persistently using a Docker volume.

For more details, see the official [Ollama
documentation](https://ollama.com/).
