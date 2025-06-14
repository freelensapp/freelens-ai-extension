import { Renderer } from "@freelensapp/extensions";
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

export const getNamespaces = tool(
  (): string[] => {
    /**
     * Get all namespaces of the Kubernetes cluster
     */
    console.log("[Tool invocation: getNamespaces]");
    const namespaceStore = Renderer.K8sApi.apiManager.getStore(
      Renderer.K8sApi.namespacesApi,
    ) as Renderer.K8sApi.NamespaceStore;
    const allNamespaces: Renderer.K8sApi.Namespace[] = namespaceStore.items.toJSON();
    const getNamespacesToolResult = allNamespaces.map((ns) => ns.getName());
    console.log("[Tool invocation result: getNamespaces] - ", getNamespacesToolResult);
    return getNamespacesToolResult;
  },
  {
    name: "getNamespaces",
    description: "Get all namespaces of the Kubernetes cluster",
  },
);

export const getWarningEventsByNamespace = tool(
  ({ namespace }: { namespace: string }): string => {
    /**
     * Get all events in status WARNING for a specific Kubernetes namespace
     */
    console.log("[Tool invocation: getWarningEventsForNamespace] - namespace: ", namespace);
    const eventStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.eventApi) as Renderer.K8sApi.EventStore;
    const allEventsByNs: Renderer.K8sApi.KubeEvent[] = eventStore.getAllByNs(namespace);
    console.log("[Tool invocation debug: getWarningEventsForNamespace] - all WARNING events: ", allEventsByNs);
    const getWarningEventsByNsToolResult = JSON.stringify(
      allEventsByNs
        .filter((event) => event.type === "Warning")
        .map((event) => ({
          event: {
            type: event.type,
            message: event.message,
            reason: event.reason,
            action: event.action,
            involvedObject: event.involvedObject,
            source: event.source,
          },
        })),
    );
    console.log("[Tool invocation result: getWarningEventsForNamespace] - ", getWarningEventsByNsToolResult);
    return getWarningEventsByNsToolResult;
  },
  {
    name: "getEventsForNamespace",
    description: "Get all events in status WARNING for a specific Kubernetes namespace",
    schema: z.object({
      namespace: z.string(),
    }),
  },
);

export const createPod = tool(
  async ({
    name,
    namespace,
    data,
  }: { name: string; namespace: string; data: Renderer.K8sApi.KubeObject }): Promise<string> => {
    /**
     * Creates a pod in the Kubernetes cluster
     */
    console.log("[Tool invocation: createPod]");

    const interruptRequest = {
      question: "Approve this action...",
      options: ["yes", "no"],
      actionToApprove: { action: "CREATE POD", name, namespace, data },
      requestString: "Approve this action: " + JSON.stringify({ action: "CREATE POD", name, namespace, data }),
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: createPod] - action not approved");
      return "The user denied the action";
    }

    try {
      const podsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.podsApi) as Renderer.K8sApi.PodsStore;
      const createPodResult: Renderer.K8sApi.Pod = await podsStore.create({ name, namespace }, data);
      console.log("[Tool invocation result: createPod] - ", createPodResult);
      return "Pod manifest applied successfully";
    } catch (error) {
      console.error("[Tool invocation error: createPod] - ", error);
      return JSON.stringify(error);
    }
  },
  {
    name: "createPod",
    description: "Creates a pod in the Kubernetes cluster",
    schema: z.object({
      namespace: z.string(),
      name: z.string(),
      data: z.object({
        apiVersion: z.string(),
        kind: z.string(),
        metadata: z.object({
          name: z.string(),
          namespace: z.string(),
        }),
        spec: z.object({
          containers: z.array(
            z.object({
              name: z.string(),
              image: z.string(),
              ports: z.array(
                z.object({
                  containerPort: z.number(),
                }),
              ),
            }),
          ),
        }),
      }),
    }),
  },
);

export const createDeployment = tool(
  async ({
    name,
    namespace,
    data,
  }: { name: string; namespace: string; data: Renderer.K8sApi.KubeObject }): Promise<string> => {
    /**
     * Creates a deployment in the Kubernetes cluster
     */
    console.log("[Tool invocation: createDeployment]");

    const interruptRequest = {
      question: "Approve this action...",
      options: ["yes", "no"],
      actionToApprove: { action: "CREATE DEPLOYMENT", name, namespace, data },
      requestString:
        "Approve this action: " +
        JSON.stringify({ action: "CREATE DEPLOYMENT", name, namespace, data }) +
        "\n\n\n options: [yes/no]",
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation] - action not approved");
      return "The user denied the action";
    }

    try {
      const deploymentsStore = Renderer.K8sApi.apiManager.getStore(
        Renderer.K8sApi.deploymentApi,
      ) as Renderer.K8sApi.DeploymentStore;
      const createDeploymentResult: Renderer.K8sApi.Deployment = await deploymentsStore.create(
        { name, namespace },
        data,
      );
      console.log("[Tool invocation result: createDeployment] - ", createDeploymentResult);
      return "Deployment manifest applied successfully";
    } catch (error) {
      console.error("[Tool invocation error: createDeployment] - ", error);
      return JSON.stringify(error);
    }
  },
  {
    name: "createDeployment",
    description: "Creates a deployment in the Kubernetes cluster",
    schema: z.object({
      namespace: z.string(),
      name: z.string(),
      data: z.object({
        apiVersion: z.string(),
        kind: z.string(),
        metadata: z.object({
          name: z.string(),
          namespace: z.string(),
        }),
        spec: z.object({
          replicas: z.number(),
          selector: z.object({
            matchLabels: z.record(z.string()),
          }),
          template: z.object({
            metadata: z.object({
              labels: z.record(z.string()),
            }),
            spec: z.object({
              containers: z.array(
                z.object({
                  name: z.string(),
                  image: z.string(),
                  ports: z.array(
                    z.object({
                      containerPort: z.number(),
                    }),
                  ),
                }),
              ),
            }),
          }),
        }),
      }),
    }),
  },
);

export const deletePod = tool(
  async ({ name, namespace }: { name: string; namespace: string }): Promise<string> => {
    /**
     * Deletes a pod in the Kubernetes cluster
     */
    console.log("[Tool invocation: deletePod]");

    const interruptRequest = {
      question: "Approve this action...",
      options: ["yes", "no"],
      actionToApprove: { action: "DELETE POD", name, namespace },
      requestString: "Approve this action: " + JSON.stringify({ action: "DELETE POD", name, namespace }),
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: deletePod] - action not approved");
      return "The user denied the action";
    }

    try {
      const podsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.podsApi) as Renderer.K8sApi.PodsStore;
      const podToRemove = podsStore.getByName(name, namespace);
      await podsStore.remove(podToRemove);
      console.log("[Tool invocation result: deletePod] - Pod deleted successfully");
      return "Pod deleted successfully";
    } catch (error) {
      console.error("[Tool invocation error: deletePod] - ", error);
      return JSON.stringify(error);
    }
  },
  {
    name: "deletePod",
    description: "Deletes a pod in the Kubernetes cluster",
    schema: z.object({
      namespace: z.string(),
      name: z.string(),
    }),
  },
);

export const deleteDeployment = tool(
  async ({ name, namespace }: { name: string; namespace: string }): Promise<string> => {
    /**
     * Deletes a deployment in the Kubernetes cluster
     */
    console.log("[Tool invocation: deleteDeployment]");

    const interruptRequest = {
      question: "Approve this action...",
      options: ["yes", "no"],
      actionToApprove: { action: "DELETE DEPLOYMENT", name, namespace },
      requestString: "Approve this action: " + JSON.stringify({ action: "DELETE DEPLOYMENT", name, namespace }),
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: deleteDeployment] - action not approved");
      return "The user denied the action";
    }

    try {
      const deploymentsStore = Renderer.K8sApi.apiManager.getStore(
        Renderer.K8sApi.deploymentApi,
      ) as Renderer.K8sApi.DeploymentStore;
      const deploymentToRemove = deploymentsStore.getByName(name, namespace);
      await deploymentsStore.remove(deploymentToRemove);
      console.log("[Tool invocation result: deleteDeployment] - Deployment deleted successfully");
      return "Deployment deleted successfully";
    } catch (error) {
      console.error("[Tool invocation error: deleteDeployment] - ", error);
      return JSON.stringify(error);
    }
  },
  {
    name: "deleteDeployment",
    description: "Deletes a deployment in the Kubernetes cluster",
    schema: z.object({
      namespace: z.string(),
      name: z.string(),
    }),
  },
);
