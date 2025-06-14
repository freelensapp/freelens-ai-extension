FROM ollama/ollama:0.7.1
ARG MODELS="llama3.2:1b mistral:7b"
RUN ollama serve & server=$! ; sleep 5 ; for m in $MODELS ; do ollama pull $m ; done ; kill $server