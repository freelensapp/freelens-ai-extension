import { describe, expect, it } from "vitest";
import { formatCanonicalForm } from "./canonical-form";
import { evaluateInvocationPolicy, type InvocationPolicyResult } from "./invocation-policy";
import { BUILT_IN_RESOURCE_CATALOG } from "./resource-catalog";

import type { PolicyProfile } from "./policy-profile";

const ASK_EVERYTHING: PolicyProfile = { id: "test", name: "Test", rules: [], fallbackLevel: "ask" };

interface EvaluateOptions {
  manifest?: string;
  revealSecrets?: boolean;
  profile?: PolicyProfile;
}

const evaluate = (args: string | readonly string[], options: EvaluateOptions = {}): InvocationPolicyResult =>
  evaluateInvocationPolicy({
    program: "kubectl",
    args: typeof args === "string" ? args.split(" ") : args,
    manifest: options.manifest,
    revealSecrets: options.revealSecrets ?? false,
    profile: options.profile ?? ASK_EVERYTHING,
    catalog: BUILT_IN_RESOURCE_CATALOG,
    defaultNamespace: "default",
  });

/** The canonical forms of an invocation the floor lets through, as text. */
const formsOf = (args: string | readonly string[], options: EvaluateOptions = {}): string[] => {
  const result = evaluate(args, options);
  if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
  return result.targets.map((target) => formatCanonicalForm(target.form));
};

describe("canonical forms of kubectl invocations", () => {
  it.each([
    ["get pods -n web", ["kubectl get pods * -n web"]],
    ["get pods -nweb", ["kubectl get pods * -n web"]],
    ["get pods -n=web", ["kubectl get pods * -n web"]],
    ["get pods --namespace web", ["kubectl get pods * -n web"]],
    ["get pods --namespace=web", ["kubectl get pods * -n web"]],
    ["-n web get pods", ["kubectl get pods * -n web"]],
    ["--namespace=web get pods api", ["kubectl get pods api -n web"]],
    ["get po", ["kubectl get pods * -n default"]],
    ["get pod api", ["kubectl get pods api -n default"]],
    ["get Pod api", ["kubectl get pods api -n default"]],
    ["get deployments.apps api", ["kubectl get deployments api -n default"]],
    ["get deploy.v1.apps api", ["kubectl get deployments api -n default"]],
    ["get pods/api", ["kubectl get pods api -n default"]],
    ["get -o yaml pods/api -n web", ["kubectl get pods api -n web"]],
    ["get -oyaml pods api", ["kubectl get pods api -n default"]],
    ["get nodes", ["kubectl get nodes *"]],
    ["get nodes node-1 -n web", ["kubectl get nodes node-1"]],
    ["get clusterrole admin", ["kubectl get clusterroles admin"]],
    ["get crd", ["kubectl get customresourcedefinitions *"]],
    ["describe deploy api", ["kubectl describe deployments api -n default"]],
  ])("kubectl %s", (args, expected) => {
    expect(formsOf(args)).toEqual(expected);
  });
});

describe("targets of kubectl invocations", () => {
  it.each([
    ["get pods,svc -n web", ["kubectl get pods * -n web", "kubectl get services * -n web"]],
    ["delete pods a b -n web", ["kubectl delete pods a -n web", "kubectl delete pods b -n web"]],
    ["get pods,svc api", ["kubectl get pods api -n default", "kubectl get services api -n default"]],
    [
      "get pod/a svc/b ns/web",
      ["kubectl get pods a -n default", "kubectl get services b -n default", "kubectl get namespaces web"],
    ],
    ["get pods a a", ["kubectl get pods a -n default"]],
    ["get pods -l app=web", ["kubectl get pods * -n default"]],
    ["get pods --selector=app=web -n web", ["kubectl get pods * -n web"]],
    ["delete pods --field-selector status.phase=Failed", ["kubectl delete pods * -n default"]],
    ["delete pods --all -n web", ["kubectl delete pods * -n web"]],
    ["delete pods --all=false api", ["kubectl delete pods api -n default"]],
    ["get pods -A", ["kubectl get pods * -n *"]],
    ["get pods,nodes --all-namespaces", ["kubectl get pods * -n *", "kubectl get nodes *"]],
    ["get pods --all-namespaces=false -n web", ["kubectl get pods * -n web"]],
    [
      "get all -n web",
      [
        "kubectl get pods * -n web",
        "kubectl get replicationcontrollers * -n web",
        "kubectl get services * -n web",
        "kubectl get daemonsets * -n web",
        "kubectl get deployments * -n web",
        "kubectl get replicasets * -n web",
        "kubectl get statefulsets * -n web",
        "kubectl get horizontalpodautoscalers * -n web",
        "kubectl get cronjobs * -n web",
        "kubectl get jobs * -n web",
      ],
    ],
    ["rollout restart deploy/api -n web", ["kubectl rollout restart deployments api -n web"]],
    ["rollout status deployment api", ["kubectl rollout status deployments api -n default"]],
    ["-n web rollout undo deploy/api --to-revision=2", ["kubectl rollout undo deployments api -n web"]],
    ["scale deploy api --replicas=3", ["kubectl scale deployments api -n default"]],
    ["label pods api app=web tier- --overwrite", ["kubectl label pods api -n default"]],
    ["label pods -l app=web tier=front", ["kubectl label pods * -n default"]],
    ["annotate deploy/api note=x", ["kubectl annotate deployments api -n default"]],
    ["taint nodes node-1 dedicated=gpu:NoSchedule", ["kubectl taint nodes node-1"]],
    ["taint nodes node-1 dedicated:NoSchedule-", ["kubectl taint nodes node-1"]],
    ["set image deploy/api app=nginx:1.27", ["kubectl set deployments api -n default"]],
    ["set env deploy/api LOG=debug -c app", ["kubectl set deployments api -n default"]],
    ["set resources deploy api --limits=cpu=200m", ["kubectl set deployments api -n default"]],
    ["set selector svc api app=web", ["kubectl set services api -n default"]],
    ["set serviceaccount deploy api robot", ["kubectl set deployments api -n default"]],
    ["set sa deploy api robot", ["kubectl set deployments api -n default"]],
    ["create deployment api --image=nginx -n web", ["kubectl create deployments api -n web"]],
    ["create deploy api --image=nginx", ["kubectl create deployments api -n default"]],
    ["create namespace web", ["kubectl create namespaces web"]],
    ["create svc clusterip api --tcp=80:8080", ["kubectl create services api -n default"]],
    ["create secret generic db --from-literal=user=admin", ["kubectl create secrets db -n default"]],
    ["create job once --image=busybox -- date", ["kubectl create jobs once -n default"]],
    ["run debug --image=busybox --restart=Never -- sleep 10", ["kubectl run pods debug -n default"]],
    ["logs api", ["kubectl logs pods api -n default"]],
    ["logs api -c app --tail=50", ["kubectl logs pods api -n default"]],
    ["logs deploy/api -n web", ["kubectl logs deployments api -n web"]],
    ["logs -l app=web --all-containers", ["kubectl logs pods * -n default"]],
    ["exec api -- ls /", ["kubectl exec pods api -n default"]],
    ["exec deploy/api -c app -- env", ["kubectl exec deployments api -n default"]],
    ["top pod", ["kubectl top pods * -n default"]],
    ["top pods api -n web", ["kubectl top pods api -n web"]],
    ["top no", ["kubectl top nodes *"]],
    ["cordon node-1 node-2", ["kubectl cordon nodes node-1", "kubectl cordon nodes node-2"]],
    ["drain node-1 --ignore-daemonsets", ["kubectl drain nodes node-1"]],
    ["events -n web", ["kubectl events events * -n web"]],
    ["events --for pod/api", ["kubectl events events * -n default"]],
    ["describe nodes", ["kubectl describe nodes *"]],
    ["version", ["kubectl version"]],
    ["api-resources --namespaced", ["kubectl api-resources"]],
    ["explain pods.spec.containers", ["kubectl explain"]],
    ["auth can-i delete pods -n web", ["kubectl auth can-i"]],
    ["cluster-info", ["kubectl cluster-info"]],
    ["wait --for=condition=Ready pod/api", ["kubectl wait pods api -n default"]],
  ])("kubectl %s", (args, expected) => {
    expect(formsOf(args)).toEqual(expected);
  });
});
