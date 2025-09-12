import { Main, Renderer } from "@freelensapp/extensions";
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";

export const getNamespaces = tool(
  (): string[] => {
    /**
     * Get all namespaces of the Kubernetes cluster
     */
    console.log("[Tool invocation: getNamespaces]");
    const namespaceStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.namespacesApi);
    if (!namespaceStore) {
      console.log("Namespace store does not exist");
      return [];
    }
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
    const eventStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.eventApi);
    if (!eventStore) {
      return "Event store does not exist";
    }
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
  async ({ name, namespace, data }: { name: string; namespace: string; data: Main.K8sApi.Pod }): Promise<string> => {
    /**
     * Creates a pod in the Kubernetes cluster
     */
    console.log("[Tool invocation: createPod]");

    const interruptRequest = {
      question: "Do you want to approve this action?",
      options: ["yes", "no"],
      actionToApprove: { action: "CREATE POD", name, namespace, data },
      requestString: "```json\n" + JSON.stringify({ action: "CREATE POD", name, namespace, data }, null, 2) + "\n```",
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: createPod] - action not approved");
      return "The user denied the action";
    }

    try {
      const podsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.podsApi);
      if (!podsStore) {
        return "Unable to get the object that can create a pod";
      }
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
    schema: z
      .object({
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
      })
      .describe("Pod K8S manifest to create"),
  },
);

export const createDeployment = tool(
  async ({
    name,
    namespace,
    data,
  }: {
    name: string;
    namespace: string;
    data: Main.K8sApi.Deployment;
  }): Promise<string> => {
    /**
     * Creates a deployment in the Kubernetes cluster
     */
    console.log("[Tool invocation: createDeployment]");

    const interruptRequest = {
      question: "Do you want to approve this action?",
      options: ["yes", "no"],
      actionToApprove: { action: "CREATE DEPLOYMENT", name, namespace, data },
      requestString:
        "```json\n" + JSON.stringify({ action: "CREATE DEPLOYMENT", name, namespace, data }, null, 2) + "\n```",
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation] - action not approved");
      return "The user denied the action";
    }

    try {
      const deploymentsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.deploymentApi);
      if (!deploymentsStore) {
        return "Unable to get the object that can create a deployment";
      }
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
    schema: z
      .object({
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
      })
      .describe("Deployment K8S manifest to create"),
  },
);

export const deletePod = tool(
  async ({ name, namespace }: { name: string; namespace: string }): Promise<string> => {
    /**
     * Deletes a pod in the Kubernetes cluster
     */
    console.log("[Tool invocation: deletePod]");

    const interruptRequest = {
      question: "Do you want to approve this action?",
      options: ["yes", "no"],
      actionToApprove: { action: "DELETE POD", name, namespace },
      requestString: "```json\n" + JSON.stringify({ action: "DELETE POD", name, namespace }, null, 2) + "\n```",
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: deletePod] - action not approved");
      return "The user denied the action";
    }

    try {
      const podsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.podsApi);
      if (!podsStore) {
        return "Unable to get the object that can delete a pod";
      }
      const podToRemove = podsStore.getByName(name, namespace);
      if (!podToRemove) {
        return "The pod you want to delete does not exist";
      }
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
      question: "Do you want to approve this action?",
      options: ["yes", "no"],
      actionToApprove: { action: "DELETE DEPLOYMENT", name, namespace },
      requestString: "```json\n" + JSON.stringify({ action: "DELETE DEPLOYMENT", name, namespace }, null, 2) + "\n```",
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: deleteDeployment] - action not approved");
      return "The user denied the action";
    }

    try {
      const deploymentsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.deploymentApi);
      if (!deploymentsStore) {
        return "The object that can delete a deployment does not exist";
      }
      const deploymentToRemove = deploymentsStore.getByName(name, namespace);
      if (!deploymentToRemove) {
        return "The deployment you want to delete does not exist";
      }
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

export const createService = tool(
  async ({ data }: { data: Main.K8sApi.Service }): Promise<string> => {
    /**
     * Creates a service in the Kubernetes cluster
     */

    if (data) {
      if (data.metadata) {
        data.metadata.apiVersion = "v1";
        data.metadata.kind = "Service";
      }
    }

    const interruptRequest = {
      question: "Approve this action...",
      options: ["yes", "no"],
      actionToApprove: { action: "CREATE SERVICE", data },
      requestString: "```json\n" + JSON.stringify({ action: "CREATE SERVICE", data }, null, 2) + "\n```",
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: createService] - action not approved");
      return "The user denied the action";
    }

    try {
      const servicesStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.serviceApi);
      if (!servicesStore) {
        return "The object that can create a service does not exist";
      }
      const createServiceResult: Renderer.K8sApi.Service = await servicesStore.create(
        {
          name: data.metadata.name,
          namespace: data.metadata.namespace,
        },
        data,
      );
      console.log("[Tool invocation result: createService] - ", createServiceResult);
      return "Service manifest applied successfully";
    } catch (error) {
      console.error("[Tool invocation error: createService] - ", error);
      return JSON.stringify(error);
    }
  },
  {
    name: "createService",
    description: "Creates a service in the Kubernetes cluster",
    schema: z
      .object({
        apiVersion: z.string(),
        kind: z.string(),
        metadata: z.object({
          name: z.string(),
          namespace: z.string().optional(),
          labels: z.record(z.string()).optional(),
          annotations: z.record(z.string()).optional(),
        }),
        spec: z.object({
          type: z.enum(["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"]).optional(),
          selector: z.record(z.string()).optional(),
          ports: z.array(
            z.object({
              name: z.string().optional(),
              protocol: z.enum(["TCP", "UDP", "SCTP"]).optional().default("TCP"),
              port: z.number().int().min(1).max(65535),
              targetPort: z.union([z.number().int().min(1).max(65535), z.string()]),
              nodePort: z.number().int().min(30000).max(32767).optional(),
            }),
          ),
          clusterIP: z.string().optional(),
          externalName: z.string().optional(),
          sessionAffinity: z.enum(["None", "ClientIP"]).optional(),
          ipFamilyPolicy: z.enum(["SingleStack", "PreferDualStack", "RequireDualStack"]).optional(),
          ipFamilies: z.array(z.string()).optional(),
        }),
      })
      .describe("Service K8S manifest to create"),
  },
);

export const deleteService = tool(
  async ({ name, namespace }: { name: string; namespace: string }): Promise<string> => {
    /**
     * Deletes a service in the Kubernetes cluster
     */
    console.log("[Tool invocation: deleteService]");

    const interruptRequest = {
      question: "Approve this action...",
      options: ["yes", "no"],
      actionToApprove: { action: "DELETE SERVICE", name, namespace },
      requestString: "```json\n" + JSON.stringify({ action: "DELETE SERVICE", name, namespace }, null, 2) + "\n```",
    };
    const review = interrupt(interruptRequest);
    console.log("Tool call review: ", review);
    if (review !== "yes") {
      console.log("[Tool invocation: deleteService] - action not approved");
      return "The user denied the action";
    }

    try {
      const servicesStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.serviceApi);
      if (!servicesStore) {
        return "The object that can delete a service does not exist";
      }
      const serviceToRemove = servicesStore.getByName(name, namespace);
      if (!serviceToRemove) {
        return "The service you want to delete does not exist";
      }
      await servicesStore.remove(serviceToRemove);
      console.log("[Tool invocation result: deleteService] - Service deleted successfully");
      return "Service deleted successfully";
    } catch (error) {
      console.error("[Tool invocation error: deleteService] - ", error);
      return JSON.stringify(error);
    }
  },
  {
    name: "deleteService",
    description: "Deletes a service in the Kubernetes cluster",
    schema: z.object({
      namespace: z.string(),
      name: z.string(),
    }),
  },
);

export const getPods = tool(
  ({ namespace }: { namespace: string }): string => {
    /**
     * Get all pods in a specific Kubernetes namespace
     */
    console.log("[Tool invocation: getPods] - namespace: ", namespace);
    const podsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.podsApi);
    if (!podsStore) {
      return "The object that can get pods does not exist";
    }
    const allPodsByNs: Renderer.K8sApi.Pod[] = podsStore.getAllByNs(namespace);
    const getPodsToolResult = JSON.stringify(
      allPodsByNs.map((pod) => ({
        name: pod.getName(),
        namespace: pod.getNs(),
        status: pod.status,
        spec: pod.spec,
        metadata: pod.metadata,
      })),
    );
    console.log("[Tool invocation result: getPods] - ", getPodsToolResult);
    return getPodsToolResult;
  },
  {
    name: "getPods",
    description: "Get all pods in a specific Kubernetes namespace",
    schema: z.object({
      namespace: z.string(),
    }),
  },
);

export const getDeployments = tool(
  ({ namespace }: { namespace: string }): string => {
    /**
     * Get all deployments in a specific Kubernetes namespace
     */
    console.log("[Tool invocation: getDeployments] - namespace: ", namespace);
    const deploymentsStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.deploymentApi);
    if (!deploymentsStore) {
      return "The object that can get deployments does not exist";
    }
    const allDeploymentsByNs: Renderer.K8sApi.Deployment[] = deploymentsStore.getAllByNs(namespace);
    const getDeploymentsToolResult = JSON.stringify(
      allDeploymentsByNs.map((deployment) => ({
        name: deployment.getName(),
        namespace: deployment.getNs(),
        status: deployment.status,
        spec: deployment.spec,
        metadata: deployment.metadata,
      })),
    );
    console.log("[Tool invocation result: getDeployments] - ", getDeploymentsToolResult);
    return getDeploymentsToolResult;
  },
  {
    name: "getDeployments",
    description: "Get all deployments in a specific Kubernetes namespace",
    schema: z.object({
      namespace: z.string(),
    }),
  },
);

export const getServices = tool(
  ({ namespace }: { namespace: string }): string => {
    /**
     * Get all services in a specific Kubernetes namespace
     */
    console.log("[Tool invocation: getServices] - namespace: ", namespace);
    const servicesStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.serviceApi);
    if (!servicesStore) {
      return "The object that can get services does not exist";
    }
    const allServicesByNs: Renderer.K8sApi.Service[] = servicesStore.getAllByNs(namespace);
    const getServicesToolResult = JSON.stringify(
      allServicesByNs.map((service) => ({
        name: service.getName(),
        namespace: service.getNs(),
        spec: service.spec,
        metadata: service.metadata,
        status: service.status,
      })),
    );
    console.log("[Tool invocation result: getServices] - ", getServicesToolResult);
    return getServicesToolResult;
  },
  {
    name: "getServices",
    description: "Get all services in a specific Kubernetes namespace",
    schema: z.object({
      namespace: z.string(),
    }),
  },
);

export const allToolFunctions = [
  getNamespaces,
  getWarningEventsByNamespace,
  createPod,
  createDeployment,
  deletePod,
  deleteDeployment,
  createService,
  deleteService,
  getPods,
  getDeployments,
  getServices,
];

// Data structure describing each tool function: name, description, arguments, and return type
export const toolFunctionDescriptions = [
  {
    name: "getNamespaces",
    description: "Get all namespaces of the Kubernetes cluster",
    arguments: "No arguments. The function does not require any input.",
    returnType: "Returns a list of all namespace names as strings.",
  },
  {
    name: "getWarningEventsByNamespace",
    description: "Get all events in status WARNING for a specific Kubernetes namespace",
    arguments: "Requires the namespace name as a string.",
    returnType: "Returns a JSON string containing all warning events for the given namespace.",
  },
  {
    name: "createPod",
    description: "Creates a pod in the Kubernetes cluster",
    arguments: "Requires the pod name (string), namespace (string), and the pod manifest data (object).",
    returnType: "Returns a message string indicating success or error after attempting to create the pod.",
  },
  {
    name: "createDeployment",
    description: "Creates a deployment in the Kubernetes cluster",
    arguments: "Requires the deployment name (string), namespace (string), and the deployment manifest data (object).",
    returnType: "Returns a message string indicating success or error after attempting to create the deployment.",
  },
  {
    name: "deletePod",
    description: "Deletes a pod in the Kubernetes cluster",
    arguments: "Requires the pod name (string) and namespace (string).",
    returnType: "Returns a message string indicating success or error after attempting to delete the pod.",
  },
  {
    name: "deleteDeployment",
    description: "Deletes a deployment in the Kubernetes cluster",
    arguments: "Requires the deployment name (string) and namespace (string).",
    returnType: "Returns a message string indicating success or error after attempting to delete the deployment.",
  },
  {
    name: "createService",
    description: "Creates a service in the Kubernetes cluster",
    arguments: "Requires the service manifest data (object).",
    returnType: "Returns a message string indicating success or error after attempting to create the service.",
  },
  {
    name: "deleteService",
    description: "Deletes a service in the Kubernetes cluster",
    arguments: "Requires the service name (string) and namespace (string).",
    returnType: "Returns a message string indicating success or error after attempting to delete the service.",
  },
  {
    name: "getPods",
    description: "Get all pods in a specific Kubernetes namespace",
    arguments: "Requires the namespace name as a string.",
    returnType: "Returns a JSON string containing all pods in the given namespace.",
  },
  {
    name: "getDeployments",
    description: "Get all deployments in a specific Kubernetes namespace",
    arguments: "Requires the namespace name as a string.",
    returnType: "Returns a JSON string containing all deployments in the given namespace.",
  },
  {
    name: "getServices",
    description: "Get all services in a specific Kubernetes namespace",
    arguments: "Requires the namespace name as a string.",
    returnType: "Returns a JSON string containing all services in the given namespace.",
  },
];
