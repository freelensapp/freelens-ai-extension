import { describe, expect, it } from "vitest";
import { formatCanonicalForm } from "./canonical-form";
import { evaluateInvocationPolicy, type InvocationPolicyResult } from "./invocation-policy";
import { BUILT_IN_RESOURCE_CATALOG } from "./resource-catalog";

import type { FloorEntryId } from "./floor";
import type { PolicyLevel, PolicyProfile, PolicyRule } from "./policy-profile";

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

const DEPLOYMENT_AND_ROLE = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: web
spec: {}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: reader
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
`;

const LIST = JSON.stringify({
  apiVersion: "v1",
  kind: "List",
  items: [
    { apiVersion: "v1", kind: "Service", metadata: { name: "api" } },
    { apiVersion: "batch/v1", kind: "Job", metadata: { generateName: "once-" } },
  ],
});

describe("targets of a manifest", () => {
  it.each([
    [
      "apply --server-side",
      DEPLOYMENT_AND_ROLE,
      [
        "kubectl apply deployments api -n web",
        "kubectl apply clusterroles reader",
        "kubectl apply configmaps settings -n default",
      ],
    ],
    [
      "apply -n dev",
      DEPLOYMENT_AND_ROLE,
      [
        "kubectl apply deployments api -n web",
        "kubectl apply clusterroles reader",
        "kubectl apply configmaps settings -n dev",
      ],
    ],
    ["create", LIST, ["kubectl create services api -n default", "kubectl create jobs * -n default"]],
    ["replace --force", LIST, ["kubectl replace services api -n default", "kubectl replace jobs * -n default"]],
    ["delete --wait=false", LIST, ["kubectl delete services api -n default", "kubectl delete jobs * -n default"]],
    [
      "diff",
      DEPLOYMENT_AND_ROLE,
      [
        "kubectl diff deployments api -n web",
        "kubectl diff clusterroles reader",
        "kubectl diff configmaps settings -n default",
      ],
    ],
  ])("kubectl %s with a manifest", (args, manifest, expected) => {
    expect(formsOf(args, { manifest })).toEqual(expected);
  });
});

const SECRET = `
apiVersion: v1
kind: Secret
metadata:
  name: db
stringData:
  password: hunter2
`;

describe("reveal", () => {
  it.each([
    ["get secrets db", false, undefined, ["kubectl get secrets db -n default"]],
    ["get secrets db -o yaml", true, undefined, ["kubectl reveal secrets db -n default"]],
    ["get secret -n web -o jsonpath={.data}", true, undefined, ["kubectl reveal secrets * -n web"]],
    ["get pods,secrets", true, undefined, ["kubectl get pods * -n default", "kubectl reveal secrets * -n default"]],
    ["describe secrets db", true, undefined, ["kubectl describe secrets db -n default"]],
    ["delete secrets db -o name", true, undefined, ["kubectl delete secrets db -n default"]],
    [
      "apply -o yaml",
      true,
      `${SECRET}---\n${DEPLOYMENT_AND_ROLE}`,
      [
        "kubectl apply secrets db -n default",
        "kubectl reveal secrets db -n default",
        "kubectl apply deployments api -n web",
        "kubectl apply clusterroles reader",
        "kubectl apply configmaps settings -n default",
      ],
    ],
    [
      "create secret generic db --from-literal=password=hunter2 -o json",
      true,
      undefined,
      ["kubectl create secrets db -n default", "kubectl reveal secrets db -n default"],
    ],
    [
      "diff --show-secrets",
      true,
      SECRET,
      ["kubectl diff secrets db -n default", "kubectl reveal secrets db -n default"],
    ],
  ])("kubectl %s with revealSecrets %s", (args, revealSecrets, manifest, expected) => {
    expect(formsOf(args, { revealSecrets, ...(manifest ? { manifest } : {}) })).toEqual(expected);
  });
});

/** The floor entry that rejects an invocation, or "passes". */
const floorEntryOf = (args: string | readonly string[], options: EvaluateOptions = {}): FloorEntryId | "passes" => {
  const result = evaluate(args, options);
  return result.kind === "floor" ? result.entry.id : "passes";
};

describe("the floor", () => {
  it.each<[string, FloorEntryId]>([
    ["get pods --kubeconfig /tmp/other", "cluster-or-identity"],
    ["--context prod get pods", "cluster-or-identity"],
    ["get pods --context=prod", "cluster-or-identity"],
    ["get pods --cluster prod", "cluster-or-identity"],
    ["get pods --server https://example.com", "cluster-or-identity"],
    ["get pods -s https://example.com", "cluster-or-identity"],
    ["get pods --token abc", "cluster-or-identity"],
    ["get pods --user admin", "cluster-or-identity"],
    ["get pods --username admin", "cluster-or-identity"],
    ["get pods --password secret", "cluster-or-identity"],
    ["get pods --as system:admin", "cluster-or-identity"],
    ["get pods --as-group system:masters", "cluster-or-identity"],
    ["get pods --as-uid 1", "cluster-or-identity"],
    ["get pods --as-user-extra a=b", "cluster-or-identity"],
    ["get pods --certificate-authority ca.crt", "cluster-or-identity"],
    ["get pods --client-certificate a.crt", "cluster-or-identity"],
    ["get pods --client-key a.key", "cluster-or-identity"],
    ["get pods --insecure-skip-tls-verify", "cluster-or-identity"],
    ["get pods --tls-server-name example.com", "cluster-or-identity"],
    ["get pods --cache-dir /tmp/cache", "cluster-or-identity"],
    ["config view --raw", "credentials-or-configuration"],
    ["config use-context prod", "credentials-or-configuration"],
    ["kuberc view", "credentials-or-configuration"],
    ["create token default", "credentials-or-configuration"],
    ["certificate approve csr-1", "credentials-or-configuration"],
    ["get pods -v=6", "credentials-or-configuration"],
    ["get pods -v 9", "credentials-or-configuration"],
    ["get pods --v=7", "credentials-or-configuration"],
    ["get pods -v8", "credentials-or-configuration"],
    ["get pods --vmodule=round_trippers=8", "credentials-or-configuration"],
    ["apply -f deployment.yaml", "local-disk-or-code"],
    ["apply --filename=deployment.yaml", "local-disk-or-code"],
    ["get -f pod.yaml", "local-disk-or-code"],
    ["apply -k overlays/dev", "local-disk-or-code"],
    ["delete --kustomize=overlays/dev", "local-disk-or-code"],
    ["cp web:/etc/passwd ./passwd", "local-disk-or-code"],
    ["create configmap settings --from-file=app.properties", "local-disk-or-code"],
    ["create secret generic db --from-env-file=.env", "local-disk-or-code"],
    ["create secret tls web --cert=tls.crt --key=tls.key", "local-disk-or-code"],
    ["patch deploy api --patch-file=patch.yaml", "local-disk-or-code"],
    ["get pods -o go-template-file=template.txt", "local-disk-or-code"],
    ["get pods -o jsonpath-file=path.txt", "local-disk-or-code"],
    ["get pods -o custom-columns-file=columns.txt", "local-disk-or-code"],
    ["get pods -o templatefile=template.txt", "local-disk-or-code"],
    ["get pods --profile=cpu", "local-disk-or-code"],
    ["get pods --profile-output=/tmp/profile", "local-disk-or-code"],
    ["get pods --kuberc /tmp/kuberc", "local-disk-or-code"],
    ["cluster-info dump --output-directory=/tmp/dump", "local-disk-or-code"],
    ["kustomize overlays/dev", "local-disk-or-code"],
    ["plugin list", "local-disk-or-code"],
    ["ctx prod", "local-disk-or-code"],
    ["proxy", "never-ends-or-terminal"],
    ["port-forward svc/api 8080:80", "never-ends-or-terminal"],
    ["attach api", "never-ends-or-terminal"],
    ["edit deploy api", "never-ends-or-terminal"],
    ["create --edit", "never-ends-or-terminal"],
    ["exec -it api -- sh", "never-ends-or-terminal"],
    ["exec api -i -- sh", "never-ends-or-terminal"],
    ["exec api --stdin -- sh", "never-ends-or-terminal"],
    ["exec api --tty -- sh", "never-ends-or-terminal"],
    ["exec api -t -- sh", "never-ends-or-terminal"],
    ["run shell --image=busybox -i -- sh", "never-ends-or-terminal"],
    ["get pods -w", "never-ends-or-terminal"],
    ["get pods --watch", "never-ends-or-terminal"],
    ["get pods --watch-only", "never-ends-or-terminal"],
    ["rollout status deploy/api -w", "never-ends-or-terminal"],
    ["logs api -f", "never-ends-or-terminal"],
    ["logs api --follow", "never-ends-or-terminal"],
    ["delete pods --all -i", "never-ends-or-terminal"],
    ["get secrets -o jsonpath={.data}", "secret-output"],
    ["get secret db -o=jsonpath-as-json={.data}", "secret-output"],
    ["get secrets -o go-template={{.data}}", "secret-output"],
    ["get secrets -o template={{.data}}", "secret-output"],
    ["get secrets -o custom-columns=DATA:.data", "secret-output"],
    ["get secrets --template={{.data}}", "secret-output"],
    ["get pods,secrets -o jsonpath={..data}", "secret-output"],
    ["create secret generic db --from-literal=password=x -o yaml", "secret-output"],
    ["delete secret db -o json", "secret-output"],
    ["label secret db team=web -o yaml", "secret-output"],
    ["get pods --raw /api/v1/secrets", "unparseable"],
    ["get --raw /api/v1/secrets", "unparseable"],
    ["get pods --no-such-flag", "unparseable"],
    ["get pods -Z", "unparseable"],
    ["get pods -n", "unparseable"],
    ["get", "unparseable"],
    ["", "unparseable"],
    ["-n web", "unparseable"],
    ["rollout", "unparseable"],
    ["rollout deploy/api", "unparseable"],
    ["auth reconcile", "unparseable"],
    ["create secret", "unparseable"],
    ["debug api -it --image=busybox", "unparseable"],
    ["completion bash", "unparseable"],
    ["version extra", "unparseable"],
    ["get pods/a b", "unparseable"],
    ["get pods,", "unparseable"],
    ["get pods a/b/c", "unparseable"],
    ["get pods -- a", "unparseable"],
    ["logs a b c", "unparseable"],
    ["logs", "unparseable"],
    ["create deployment --image=nginx", "unparseable"],
    ["apply", "unparseable"],
    ["create -n web deployment api --image=nginx", "unparseable"],
    ["set env deploy/api --from=secret/db --resolve", "unparseable"],
    ["set selector svc", "unparseable"],
    ["cordon node/node-1", "unparseable"],
    ["events api", "unparseable"],
    ["get frobnicators", "unknown-resource"],
    ["get pods,frobnicators", "unknown-resource"],
    ["logs frobnicator/a", "unknown-resource"],
    ["get deployments.example.com", "unknown-resource"],
  ])("kubectl %s is rejected by %s", (args, entry) => {
    expect(floorEntryOf(args === "" ? [] : args)).toBe(entry);
  });

  it.each<[string, FloorEntryId, string]>([
    ["apply --prune -l app=web", "unparseable", DEPLOYMENT_AND_ROLE],
    ["apply --all", "unparseable", DEPLOYMENT_AND_ROLE],
    ["get pods", "manifest", DEPLOYMENT_AND_ROLE],
    ["create deployment api --image=nginx", "manifest", DEPLOYMENT_AND_ROLE],
    ["apply", "manifest", "kind: [unclosed"],
    ["apply", "manifest", ""],
    ["apply", "manifest", "---\n---\n"],
    ["apply", "manifest", "apiVersion: v1\nmetadata:\n  name: x\n"],
    ["apply", "manifest", "apiVersion: v1\nkind: ConfigMap\nmetadata: {}\n"],
    ["apply", "manifest", "- a\n- b\n"],
    ["apply", "unknown-resource", "apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: x\n"],
    ["delete pods api", "unparseable", SECRET],
    ["apply -o yaml", "secret-output", SECRET],
    ["diff --show-secrets", "secret-output", SECRET],
  ])("kubectl %s with a manifest is rejected by %s", (args, entry, manifest) => {
    expect(floorEntryOf(args, { manifest })).toBe(entry);
  });

  it.each<[string, string | undefined]>([
    ["get pods --watch=false", undefined],
    ["get pods -w=false", undefined],
    ["rollout status deploy/api --watch=false", undefined],
    ["exec api --stdin=false -- ls", undefined],
    ["get pods --insecure-skip-tls-verify=false", undefined],
    ["get pods -v=5", undefined],
    ["get pods --v 2", undefined],
    ["logs api --follow=false", undefined],
    ["get pods --request-timeout=10s", undefined],
    ["get secrets -o yaml", undefined],
    ["get secrets db -o json", undefined],
    ["get secrets -o wide", undefined],
    ["get secrets -o name", undefined],
    ["describe secret db", undefined],
    ["delete secret db -o name", undefined],
    ["delete secret db", undefined],
    ["apply -o name", SECRET],
    ["diff", SECRET],
    ["get pods -o jsonpath={.items[*].metadata.name}", undefined],
    ["apply --dry-run=server -o yaml", DEPLOYMENT_AND_ROLE],
    ["create --dry-run=server -o yaml", DEPLOYMENT_AND_ROLE],
  ])("kubectl %s passes the floor", (args, manifest) => {
    expect(floorEntryOf(args, manifest === undefined ? {} : { manifest })).toBe("passes");
  });

  it("names the flag it does not support, so that the agent can run the invocation without it", () => {
    expect(evaluate("get pods --raw /api")).toMatchObject({
      kind: "floor",
      reason: "Arguments the parser cannot place: --raw is not a supported flag of kubectl get; run it without --raw.",
    });
  });

  it("gives the floor entry's reason for verbose logging", () => {
    const result = evaluate("get pods -v=7");
    expect(result.kind === "floor" && result.entry.reason).toMatch(/request headers.*bearer token.*response bodies/);
  });
});

const profileOf = (rules: Record<string, PolicyLevel>, fallbackLevel: PolicyLevel = "ask"): PolicyProfile => ({
  id: "rules",
  name: "Rules",
  rules: Object.entries(rules).map(([pattern, level]): PolicyRule => ({ pattern, level })),
  fallbackLevel,
});

/** The level of an invocation and, per canonical form, its level and the pattern of the rule that decided it. */
const decide = (args: string, profile: PolicyProfile, options: EvaluateOptions = {}) => {
  const result = evaluate(args, { ...options, profile });
  if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
  return {
    level: result.level,
    targets: result.targets.map((target) => [formatCanonicalForm(target.form), target.level, target.rule?.pattern]),
  };
};

describe("policy rules", () => {
  const deletes = profileOf(
    {
      "kubectl delete *": "allow",
      "kubectl delete pods": "ask",
      "kubectl delete pods web-*": "alwaysAsk",
      "kubectl delete pods web-1 -n dev": "deny",
    },
    "allow",
  );

  it.each([
    ["delete pods web-1 -n dev", "deny", "kubectl delete pods web-1 -n dev"],
    ["delete pods web-1 -n prod", "alwaysAsk", "kubectl delete pods web-*"],
    ["delete pods api", "ask", "kubectl delete pods"],
    ["delete pods -l app=web", "ask", "kubectl delete pods"],
    ["delete pods --all -n dev", "ask", "kubectl delete pods"],
    ["delete svc api", "allow", "kubectl delete *"],
    ["get pods", "allow", undefined],
  ])("the most specific rule decides kubectl %s", (args, level, pattern) => {
    const decision = decide(args, deletes);
    expect(decision.level).toBe(level);
    expect(decision.targets[0]?.[2]).toBe(pattern);
  });

  it("gives the most restrictive level on a tie of specificity", () => {
    const profile = profileOf({ "kubectl get pods * -n dev": "allow", "kubectl get * api -n dev": "deny" }, "ask");
    expect(decide("get pods api -n dev", profile).targets).toEqual([
      ["kubectl get pods api -n dev", "deny", "kubectl get * api -n dev"],
    ]);
    expect(decide("get pods other -n dev", profile).level).toBe("allow");
  });

  it("counts a glob less than a literal and more than *", () => {
    const profile = profileOf(
      { "kubectl get pods *": "allow", "kubectl get pods web-*": "deny", "kubectl get pods web-1": "ask" },
      "alwaysAsk",
    );
    expect(decide("get pods web-1", profile).level).toBe("ask");
    expect(decide("get pods web-2", profile).level).toBe("deny");
    expect(decide("get pods api", profile).level).toBe("allow");
    const globVerb = profileOf({ "kubectl rollout *": "deny", "kubectl * deployments": "allow" }, "ask");
    expect(decide("rollout restart deploy/api", globVerb).level).toBe("allow");
    expect(decide("rollout restart sts/db", globVerb).level).toBe("deny");
  });

  it("gives the fallback level to a canonical form no rule matches", () => {
    expect(decide("get pods", profileOf({ "kubectl delete *": "allow" }, "deny"))).toEqual({
      level: "deny",
      targets: [["kubectl get pods * -n default", "deny", undefined]],
    });
  });

  it("gives the invocation the most restrictive level of its canonical forms", () => {
    const profile = profileOf({ "kubectl delete pods": "allow", "kubectl delete services": "alwaysAsk" }, "ask");
    expect(decide("delete pods,svc api", profile)).toEqual({
      level: "alwaysAsk",
      targets: [
        ["kubectl delete pods api -n default", "allow", "kubectl delete pods"],
        ["kubectl delete services api -n default", "alwaysAsk", "kubectl delete services"],
      ],
    });
  });

  it.each([
    ["get pods", "allow"],
    ["get nodes", "allow"],
    ["version", "allow"],
    ["rollout status deploy/api", "deny"],
    ["rollout restart deploy/api", "deny"],
  ])("lets omitted trailing parts mean *: kubectl %s", (args, level) => {
    expect(
      decide(args, profileOf({ "kubectl get": "allow", "kubectl version": "allow", "kubectl rollout": "deny" }, "ask"))
        .level,
    ).toBe(level);
  });

  it.each([
    ["delete pods -l app=web -n dev", "ask"],
    ["delete pods api -n dev", "deny"],
    ["get pods -A", "ask"],
    ["get pods -n dev", "allow"],
    ["get nodes", "ask"],
  ])("matches a canonical * name or namespace only by * or an omitted part: kubectl %s", (args, level) => {
    const profile = profileOf(
      {
        "kubectl delete pods web-* -n dev": "deny",
        "kubectl delete pods api -n dev": "deny",
        "kubectl get * * -n dev": "allow",
      },
      "ask",
    );
    expect(decide(args, profile).level).toBe(level);
  });

  it.each([
    ["get nodes", "deny"],
    ["get pods -A", "deny"],
    ["get pods -n prod", "allow"],
  ])("matches every namespace and cluster-scoped resources by a rule without -n: kubectl %s", (args, level) => {
    const profile = profileOf({ "kubectl get": "deny", "kubectl get pods * -n prod": "allow" }, "ask");
    expect(decide(args, profile).level).toBe(level);
  });

  it("does not match a cluster-scoped resource by a rule with a namespace", () => {
    expect(decide("get nodes", profileOf({ "kubectl get * * -n dev": "deny" }, "allow")).level).toBe("allow");
  });

  it.each([
    ["kubectl delete ns *", "delete namespace web"],
    ["kubectl delete namespace", "delete ns web"],
    ["kubectl get deploy api -n web", "get deployments.apps api -n web"],
    ["kubectl get Pod", "get po"],
  ])("normalizes the resource of the rule %s through the catalog", (pattern, args) => {
    expect(decide(args, profileOf({ [pattern]: "deny" }, "allow")).level).toBe("deny");
  });

  it("matches every invocation by the rule kubectl", () => {
    expect(decide("get pods a", profileOf({ kubectl: "deny" }, "allow")).level).toBe("deny");
  });

  it("never matches a rule of another program or one that is not a pattern", () => {
    const profile = profileOf(
      { "helm list": "deny", "kubectl get pods a b c": "deny", "kubectl get -n": "deny", "": "deny" },
      "allow",
    );
    expect(decide("get pods a", profile).level).toBe("allow");
  });
});
