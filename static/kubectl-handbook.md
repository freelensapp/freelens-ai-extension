# Kubectl Handbook

A concise reference for the most commonly-used `kubectl` subcommands, grouped by category. Each section includes a short description, common flags, and examples to use as quick reminders. Use `kubectl <command> --help` for full details.

## Command, Example, Explaination

### `kubectl create`

Create resources from files or stdin.

- Common: `kubectl create -f file.yaml`, `kubectl create deployment nginx --image=nginx`
- Notes: Use for imperative creation. For declarative apply/use `kubectl apply`.

### `kubectl expose`

Expose a resource (pod/rc/service/deployment) as a Service.

- Example: `kubectl expose deployment nginx --port=80 --target-port=8080 --type=LoadBalancer`

### `kubectl run`

Run a single instance of an image on the cluster (often used for quick pods).

- Example: `kubectl run busybox --image=busybox --restart=Never -- sleep 3600`

### `kubectl set`

Modify object fields (image, resources, selector, etc.).

- Example: `kubectl set image deployment/nginx nginx=nginx:1.9.1`

### `kubectl explain`

Show documentation for a resource type or field.

- Example: `kubectl explain deployment.spec.template.spec.containers`

### `kubectl get`

Show one or many resources.

- Common: `kubectl get pods`, `kubectl get pods -o wide`, `kubectl get pods -n my-ns`
- Useful flags: `-o json|yaml|name|custom-columns|wide`, `-A` for all namespaces

### `kubectl edit`

Edit a resource on the server using your $EDITOR.

- Example: `kubectl edit deployment/nginx`

### `kubectl delete`

Delete resources by file, resource, name, or selector.

- Examples: `kubectl delete -f service.yaml`, `kubectl delete pod mypod`, `kubectl delete pods --all`

### `kubectl rollout`

Manage rollouts for deployments/daemonsets/statefulsets.

- Examples: `kubectl rollout status deployment/nginx`, `kubectl rollout undo deployment/nginx`

### `kubectl scale`

Set replicas for a deployment/replicaset.

- Example: `kubectl scale deployment nginx --replicas=4`

### `kubectl autoscale`

Autoscale a deployment.

- Example: `kubectl autoscale deployment nginx --min=1 --max=10 --cpu-percent=80`

### `kubectl certificate`

Manage cert signing requests and certificate resources.

### `kubectl cluster-info`

Display master and service endpoints for the cluster.

### `kubectl top`

Show resource (CPU/memory) usage of nodes or pods.

- Example: `kubectl top pods` or `kubectl top nodes`

### Node commands: `cordon`, `uncordon`, `drain`, `taint`

- `cordon NODE` marks node unschedulable.
- `uncordon NODE` marks node schedulable.
- `drain NODE` evicts pods for maintenance.
- `taint NODE key=value:NoSchedule` applies taints to control scheduling.

### `kubectl describe`

Show detailed state of a resource including events and conditions.

- Example: `kubectl describe pod mypod`

### `kubectl logs`

Print logs for a container in a pod.

- Example: `kubectl logs pod/mypod -c mycontainer` or `kubectl logs -f pod/mypod`

### `kubectl attach` / `kubectl exec`

- `attach` connects to a container's stdio of a running pod.
- `exec` runs a command in a container: `kubectl exec -it pod/mypod -- /bin/sh`

### `kubectl port-forward`

Forward local ports to a pod for debugging: `kubectl port-forward svc/myservice 8080:80`

### `kubectl proxy`

Run a local proxy to the Kubernetes API server: `kubectl proxy --port=8001`

### `kubectl cp`

Copy files to/from containers: `kubectl cp /tmp/file pod:/tmp/file -c container`

### `kubectl auth`

Inspect authorization: `kubectl auth can-i create pods`

### `kubectl debug`

Create ephemeral containers or debug node workloads: `kubectl debug node/mynode --image=busybox`

### `kubectl events`

List cluster events, e.g., `kubectl events --all-namespaces` or `kubectl events --for pod/mypod --watch`

### `kubectl diff`

Show differences between the live config and the config to be applied: `kubectl diff -f deployment.yaml`

### `kubectl apply`

Declarative resource management; preferred for day‑to‑day manifests.

- Common: `kubectl apply -f ./manifests` or `kubectl apply -k ./overlay`
- Important flags: `--server-side`, `--prune`, `--dry-run`, `--field-manager`

### `kubectl patch`

Patch resource fields using strategic/merge/json patches.

- Example: `kubectl patch deployment nginx -p '{"spec":{"replicas":3}}'`

### `kubectl replace`

Replace a resource with the provided manifest: `kubectl replace -f resource.yaml`

### `kubectl wait`

Wait for a condition (Ready, create, delete, or jsonpath) on resources: `kubectl wait --for=condition=Ready pod/mypod --timeout=30s`

### `kubectl kustomize`

Build kustomize manifests: `kubectl kustomize ./overlays/prod`

### `kubectl label`

Update labels on resources: `kubectl label pod mypod env=prod --overwrite`

### `kubectl annotate`

Add or update annotations: `kubectl annotate svc mysvc description='web front end'`

### `kubectl completion`

Generate shell completion scripts for your shell (bash, zsh, fish, powershell).

### `kubectl api-resources` / `kubectl api-versions`

Inspect server-supported resources and API versions.

### `kubectl config`

Manage kubeconfig contexts and credentials: `kubectl config use-context`, `kubectl config view`

### `kubectl plugin`

Manage kubectl plugins (krew ecosystem): `kubectl plugin list`

### `kubectl version`

Show client/server versions.

### `kubectl options`

List global options that apply to any kubectl command.

---

## Tips & Best Practices 💡

- Prefer `kubectl apply` for declarative workflows; use `kubectl create` or `run` for quick one-offs.
- Use `-o` output formats (json/yaml) for scripting and `--dry-run=client|server` to test changes.
- Combine `kubectl get -o yaml` with `kubectl apply -f -` for safe edits.
- Use `kubectl explain <resource>` to discover fields and types.
- Keep `kubectl` up to date with your cluster's recommended version (client/server skew matters).
