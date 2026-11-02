import { describe, expect, it } from "vitest";
import { formatCanonicalForm } from "./canonical-form";
import { DRY_RUN_VERBS } from "./dry-run-verbs";
import { evaluateInvocationPolicy, type InvocationPolicyResult } from "./invocation-policy";
import { BUILT_IN_RESOURCE_CATALOG } from "./resource-catalog";
import { PERMISSIVE_PROFILE, READ_ONLY_PROFILE, SHIPPED_PROFILES, STANDARD_PROFILE } from "./shipped-profiles";

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
    ["get resourceclaims.resource.k8s.io gpu", ["kubectl get resourceclaims gpu -n default"]],
    ["get deviceclass", ["kubectl get deviceclasses *"]],
    ["get vac", ["kubectl get volumeattributesclasses *"]],
    ["get ev", ["kubectl get events * -n default"]],
    ["get events.events.k8s.io", ["kubectl get events * -n default"]],
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
    ["describe secrets db", true, undefined, ["kubectl reveal secrets db -n default"]],
    ["describe secrets/db -n web", true, undefined, ["kubectl reveal secrets db -n web"]],
    [
      "describe pods,secrets",
      true,
      undefined,
      ["kubectl describe pods * -n default", "kubectl reveal secrets * -n default"],
    ],
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
    ["describe secret db", "secret-output"],
    ["describe secrets", "secret-output"],
    ["describe secrets/db -n web", "secret-output"],
    ["describe pods,secrets -A", "secret-output"],
    ["describe sa,secrets default", "secret-output"],
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

  it("rejects a describe of a category that includes Secrets, and lets it through with revealSecrets as a reveal", () => {
    const catalog = BUILT_IN_RESOURCE_CATALOG.map((resource) =>
      resource.name === "secrets" || resource.name === "configmaps"
        ? { ...resource, categories: [...resource.categories, "settings"] }
        : resource,
    );
    const describeSettings = (revealSecrets: boolean) =>
      evaluateInvocationPolicy({
        program: "kubectl",
        args: ["describe", "settings", "-n", "web"],
        revealSecrets,
        profile: ASK_EVERYTHING,
        catalog,
        defaultNamespace: "default",
      });

    const rejected = describeSettings(false);
    expect(rejected.kind === "floor" && rejected.entry.id).toBe("secret-output");
    const revealed = describeSettings(true);
    expect(revealed.kind === "policy" && revealed.targets.map((target) => formatCanonicalForm(target.form))).toEqual([
      "kubectl describe configmaps * -n web",
      "kubectl reveal secrets * -n web",
    ]);
  });

  it("names the flag it does not support, so that the agent can run the invocation without it", () => {
    expect(evaluate("get pods --raw /api")).toMatchObject({
      kind: "floor",
      reason: "Arguments the parser cannot place: --raw is not a supported flag of kubectl get; run it without --raw.",
    });
  });

  it.each([
    [
      "create -n web deployment api --image=nginx",
      "Arguments the parser cannot place: write kubectl create deployment before the flags.",
    ],
    [
      "apply view-last-applied deploy/api",
      "Arguments the parser cannot place: kubectl apply does not take the argument view-last-applied.",
    ],
    ["apply", "Arguments the parser cannot place: kubectl apply needs the manifest parameter."],
    ["get pods -n", "Arguments the parser cannot place: -n of kubectl get needs a value."],
    [
      "frobnicate pods",
      "The user's disk and local code: frobnicate is not a kubectl verb, and kubectl would look for a plugin of that name.",
    ],
    ["get pods --context prod", "Flags that change the cluster or the identity: --context is never allowed."],
    ["get pods -v=8", "Credentials and configuration: -v 8 is never allowed."],
    [
      "describe secrets db",
      "Output that prints Secret values around the redaction: kubectl describe prints the values of Secrets such " +
        "as service-account tokens without revealSecrets; use get secrets, whose values are redacted, or set " +
        "revealSecrets.",
    ],
    ["get frobnicators", "Resources the cluster does not serve: the resource catalog has no resource frobnicators."],
  ])("explains why kubectl %s is rejected", (args, reason) => {
    expect(evaluate(args)).toMatchObject({ kind: "floor", reason });
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

const NAMESPACE = "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: web\n";

describe("the shipped profiles", () => {
  it("have fixed ids and names", () => {
    expect(SHIPPED_PROFILES.map((profile) => [profile.id, profile.name, profile.fallbackLevel])).toEqual([
      ["read-only", "Read only", "deny"],
      ["standard", "Standard", "ask"],
      ["permissive", "Permissive", "ask"],
    ]);
  });

  it.each<[string, string, EvaluateOptions, PolicyLevel]>([
    [READ_ONLY_PROFILE.id, "get pods -A", {}, "allow"],
    [READ_ONLY_PROFILE.id, "describe deploy api", {}, "allow"],
    [READ_ONLY_PROFILE.id, "top pod", {}, "allow"],
    [READ_ONLY_PROFILE.id, "events", {}, "allow"],
    [READ_ONLY_PROFILE.id, "explain pods", {}, "allow"],
    [READ_ONLY_PROFILE.id, "api-resources", {}, "allow"],
    [READ_ONLY_PROFILE.id, "api-versions", {}, "allow"],
    [READ_ONLY_PROFILE.id, "version", {}, "allow"],
    [READ_ONLY_PROFILE.id, "auth can-i delete pods", {}, "allow"],
    [READ_ONLY_PROFILE.id, "diff", { manifest: NAMESPACE }, "allow"],
    [READ_ONLY_PROFILE.id, "rollout status deploy/api", {}, "allow"],
    [READ_ONLY_PROFILE.id, "rollout history deploy/api", {}, "allow"],
    [READ_ONLY_PROFILE.id, "logs api", {}, "ask"],
    [READ_ONLY_PROFILE.id, "get secrets db", { revealSecrets: true }, "ask"],
    [READ_ONLY_PROFILE.id, "scale deploy api --replicas=2", {}, "deny"],
    [READ_ONLY_PROFILE.id, "delete pod api", {}, "deny"],
    [STANDARD_PROFILE.id, "get pods", {}, "allow"],
    [STANDARD_PROFILE.id, "logs api", {}, "ask"],
    [STANDARD_PROFILE.id, "get secrets db", { revealSecrets: true }, "ask"],
    [STANDARD_PROFILE.id, "scale deploy api --replicas=2", {}, "ask"],
    [STANDARD_PROFILE.id, "delete pod api", {}, "ask"],
    [STANDARD_PROFILE.id, "exec api -- ls", {}, "alwaysAsk"],
    [STANDARD_PROFILE.id, "drain node-1", {}, "alwaysAsk"],
    [STANDARD_PROFILE.id, "delete ns web", {}, "alwaysAsk"],
    [STANDARD_PROFILE.id, "delete", { manifest: NAMESPACE }, "alwaysAsk"],
    [PERMISSIVE_PROFILE.id, "get pods", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "logs api", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "apply", { manifest: DEPLOYMENT_AND_ROLE }, "allow"],
    [PERMISSIVE_PROFILE.id, "create deployment api --image=nginx", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "replace", { manifest: DEPLOYMENT_AND_ROLE }, "allow"],
    [PERMISSIVE_PROFILE.id, "patch deploy api -p {}", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "delete pods -l app=web", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "scale deploy api --replicas=2", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "label pods api a=b", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "annotate pods api a=b", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "set image deploy/api app=nginx", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "rollout restart deploy/api", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "rollout undo deploy/api", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "rollout pause deploy/api", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "rollout resume deploy/api", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "cordon node-1", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "uncordon node-1", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "taint nodes node-1 a=b:NoSchedule", {}, "allow"],
    [PERMISSIVE_PROFILE.id, "get secrets db", { revealSecrets: true }, "ask"],
    [PERMISSIVE_PROFILE.id, "run debug --image=busybox", {}, "ask"],
    [PERMISSIVE_PROFILE.id, "exec api -- ls", {}, "alwaysAsk"],
    [PERMISSIVE_PROFILE.id, "drain node-1", {}, "alwaysAsk"],
    [PERMISSIVE_PROFILE.id, "delete", { manifest: NAMESPACE }, "alwaysAsk"],
  ])("%s gives kubectl %s (%o) the level %s", (profileId, args, options, level) => {
    const profile = SHIPPED_PROFILES.find((shipped) => shipped.id === profileId);
    expect(profile && decide(args, profile, options).level).toBe(level);
  });

  it.each([
    "namespaces",
    "nodes",
    "customresourcedefinitions",
    "persistentvolumes",
    "clusterroles",
    "clusterrolebindings",
    "storageclasses",
    "priorityclasses",
    "ingressclasses",
    "apiservices",
    "mutatingwebhookconfigurations",
    "validatingwebhookconfigurations",
  ])("always ask before a delete of %s in Standard and Permissive", (resource) => {
    expect(decide(`delete ${resource} x`, STANDARD_PROFILE).level).toBe("alwaysAsk");
    expect(decide(`delete ${resource} x`, PERMISSIVE_PROFILE).level).toBe("alwaysAsk");
  });
});

const dryRunVerbOf = (verb: string) => DRY_RUN_VERBS.kubectl.find((candidate) => candidate.verb === verb);

describe("the dry-run verbs", () => {
  it.each<[string, string | undefined]>([
    ["apply", DEPLOYMENT_AND_ROLE],
    ["create", DEPLOYMENT_AND_ROLE],
    ["create deployment api --image=nginx", undefined],
    ["create namespace web", undefined],
    ["replace", DEPLOYMENT_AND_ROLE],
    ["patch deploy api -p {}", undefined],
    ["delete pod api", undefined],
    ["delete", DEPLOYMENT_AND_ROLE],
    ["scale deploy api --replicas=2", undefined],
    ["label pods api a=b", undefined],
    ["annotate pods api a=b", undefined],
    ["set env deploy/api A=b", undefined],
    ["set image deploy/api app=nginx", undefined],
    ["set resources deploy/api --limits=cpu=1", undefined],
    ["set selector svc api app=web", undefined],
    ["set serviceaccount deploy api robot", undefined],
    ["set subject rolebinding admin --user=alice", undefined],
    ["rollout undo deploy/api", undefined],
    ["cordon node-1", undefined],
    ["uncordon node-1", undefined],
    ["drain node-1", undefined],
    ["taint nodes node-1 a=b:NoSchedule", undefined],
  ])("name the verb of kubectl %s, which accepts --dry-run=server", (args, manifest) => {
    const options = manifest === undefined ? {} : { manifest };
    const result = evaluate(`${args} --dry-run=server`, options);
    if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
    const verb = result.targets[0]?.form.verb ?? "";
    expect(dryRunVerbOf(verb)).toBeDefined();
    if (dryRunVerbOf(verb)?.acceptsYamlOutput)
      expect(floorEntryOf(`${args} --dry-run=server -o yaml`, options)).toBe("passes");
  });

  it.each(["cordon node-1", "uncordon node-1", "drain node-1"])("say that kubectl %s takes no -o", (args) => {
    expect(dryRunVerbOf(args.split(" ")[0] ?? "")?.acceptsYamlOutput).toBe(false);
    expect(floorEntryOf(`${args} --dry-run=server -o yaml`)).toBe("unparseable");
  });

  it("say that kubectl delete takes no -o yaml", () => {
    expect(dryRunVerbOf("delete")?.acceptsYamlOutput).toBe(false);
  });

  it.each(["get pods", "logs api", "exec api -- ls", "rollout pause deploy/api", "run debug --image=busybox"])(
    "leave out the verb of kubectl %s",
    (args) => {
      const result = evaluate(args);
      if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
      expect(result.targets.some((target) => dryRunVerbOf(target.form.verb))).toBe(false);
    },
  );

  it("leave out kubectl rollout restart, which has no --dry-run", () => {
    expect(dryRunVerbOf("rollout restart")).toBeUndefined();
    expect(floorEntryOf("rollout restart deploy/api --dry-run=server")).toBe("unparseable");
  });
});

const evaluateHelm = (args: string | readonly string[], options: EvaluateOptions = {}): InvocationPolicyResult =>
  evaluateInvocationPolicy({
    program: "helm",
    args: typeof args === "string" ? args.split(" ").filter(Boolean) : args,
    manifest: options.manifest,
    revealSecrets: options.revealSecrets ?? false,
    profile: options.profile ?? ASK_EVERYTHING,
    catalog: BUILT_IN_RESOURCE_CATALOG,
    defaultNamespace: "default",
  });

const helmFormsOf = (args: string | readonly string[]): string[] => {
  const result = evaluateHelm(args);
  if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
  return result.targets.map((target) => formatCanonicalForm(target.form));
};

const helmFloorEntryOf = (args: string | readonly string[], options: EvaluateOptions = {}): FloorEntryId | "passes" => {
  const result = evaluateHelm(args, options);
  return result.kind === "floor" ? result.entry.id : "passes";
};

describe("canonical forms of helm invocations", () => {
  it.each([
    ["list", ["helm list releases * -n default"]],
    ["ls -n web", ["helm list releases * -n web"]],
    ["-n web list", ["helm list releases * -n web"]],
    ["list -A", ["helm list releases * -n *"]],
    ["list --all-namespaces -o json --filter ^web", ["helm list releases * -n *"]],
    ["list -nweb -f web -l owner=helm -q", ["helm list releases * -n web"]],
    ["status web", ["helm status releases web -n default"]],
    ["status web --namespace=prod -o table --revision 2", ["helm status releases web -n prod"]],
    ["history web -n prod --max 5", ["helm history releases web -n prod"]],
    ["hist web", ["helm history releases web -n default"]],
    ["get values web -a -o json", ["helm get values releases web -n default"]],
    ["get manifest web -n prod --revision=3", ["helm get manifest releases web -n prod"]],
    ["get notes web", ["helm get notes releases web -n default"]],
    ["show values bitnami/nginx --version 15.0.0", ["helm show charts bitnami/nginx"]],
    ["show chart bitnami/nginx -n web", ["helm show charts bitnami/nginx"]],
    ["inspect readme bitnami/nginx", ["helm show charts bitnami/nginx"]],
    ["show all bitnami/nginx --devel", ["helm show charts bitnami/nginx"]],
    ["show crds bitnami/nginx", ["helm show charts bitnami/nginx"]],
    ["search repo nginx", ["helm search repo charts *"]],
    ["search repo -l --version ^1.0 bitnami/", ["helm search repo charts *"]],
    ["search repo", ["helm search repo charts *"]],
    ["rollback web", ["helm rollback releases web -n default"]],
    ["rollback web 2 -n prod --wait --timeout 2m", ["helm rollback releases web -n prod"]],
    ["uninstall web api -n prod", ["helm uninstall releases web -n prod", "helm uninstall releases api -n prod"]],
    ["del web --keep-history", ["helm uninstall releases web -n default"]],
    ["un web web", ["helm uninstall releases web -n default"]],
    ["upgrade web bitnami/nginx --reuse-values --set replicaCount=2", ["helm upgrade releases web -n default"]],
    [
      "upgrade web bitnami/nginx -n prod --reuse-values --set a=1 --set b=2 --dry-run=server",
      ["helm upgrade releases web -n prod"],
    ],
  ])("helm %s", (args, expected) => {
    expect(helmFormsOf(args)).toEqual(expected);
  });

  it.each([
    ["get manifest web", ["helm reveal releases web -n default"]],
    ["status web -n prod -o json", ["helm reveal releases web -n prod"]],
    ["status web", ["helm reveal releases web -n default"]],
    [
      "upgrade web bitnami/nginx --reuse-values --set a=1 --dry-run",
      ["helm upgrade releases web -n default", "helm reveal releases web -n default"],
    ],
    ["rollback web 2 --dry-run", ["helm rollback releases web -n default", "helm reveal releases web -n default"]],
    ["get values web", ["helm get values releases web -n default"]],
    ["list -A", ["helm list releases * -n *"]],
    ["uninstall web", ["helm uninstall releases web -n default"]],
  ])("helm %s with revealSecrets", (args, expected) => {
    const result = evaluateHelm(args, { revealSecrets: true });
    expect(result.kind === "policy" && result.targets.map((target) => formatCanonicalForm(target.form))).toEqual(
      expected,
    );
  });
});

describe("the floor of helm", () => {
  it.each<[string, FloorEntryId]>([
    ["list --kube-context prod", "cluster-or-identity"],
    ["--kube-apiserver https://example.com list", "cluster-or-identity"],
    ["list --kube-as-user admin", "cluster-or-identity"],
    ["list --kube-as-group system:masters", "cluster-or-identity"],
    ["list --kube-ca-file ca.crt", "cluster-or-identity"],
    ["list --kube-insecure-skip-tls-verify", "cluster-or-identity"],
    ["list --kube-tls-server-name example.com", "cluster-or-identity"],
    ["list --kube-token abc", "cluster-or-identity"],
    ["list --kubeconfig /tmp/other", "cluster-or-identity"],
    ["registry login ghcr.io -u me -p secret", "credentials-or-configuration"],
    ["repo add bitnami https://charts.bitnami.com/bitnami", "credentials-or-configuration"],
    ["upgrade web ./chart --reuse-values", "local-disk-or-code"],
    ["upgrade web /charts/nginx --reuse-values", "local-disk-or-code"],
    ["upgrade web nginx --reuse-values", "local-disk-or-code"],
    ["upgrade web nginx-15.0.0.tgz --reuse-values", "local-disk-or-code"],
    ["upgrade web bitnami/nginx-15.0.0.tgz --reuse-values", "local-disk-or-code"],
    ["upgrade web oci://registry/charts/nginx --reuse-values", "local-disk-or-code"],
    ["upgrade web https://example.com/nginx.tgz --reuse-values", "local-disk-or-code"],
    ["upgrade web ~/charts/nginx --reuse-values", "local-disk-or-code"],
    ["upgrade web a/b/c --reuse-values", "local-disk-or-code"],
    ["upgrade web bitnami/nginx --reuse-values -f values.yaml", "local-disk-or-code"],
    ["upgrade web bitnami/nginx --reuse-values --values=values.yaml", "local-disk-or-code"],
    ["upgrade web bitnami/nginx --reuse-values --set-file key=file.txt", "local-disk-or-code"],
    ["upgrade web bitnami/nginx --reuse-values --post-renderer ./render.sh", "local-disk-or-code"],
    ["upgrade web bitnami/nginx --reuse-values --post-renderer-args x", "local-disk-or-code"],
    ["upgrade web nginx --reuse-values --repo https://charts.example.com", "local-disk-or-code"],
    ["upgrade web bitnami/nginx --reuse-values --keyring /tmp/keys", "local-disk-or-code"],
    ["show values ./chart", "local-disk-or-code"],
    ["show values oci://registry/charts/nginx", "local-disk-or-code"],
    ["show values nginx --repo https://charts.example.com", "local-disk-or-code"],
    ["show chart bitnami/nginx --ca-file ca.crt", "local-disk-or-code"],
    ["rollback web --post-renderer ./render.sh", "local-disk-or-code"],
    ["list --repository-config /tmp/repos.yaml", "local-disk-or-code"],
    ["list --registry-config /tmp/config.json", "local-disk-or-code"],
    ["list --repository-cache /tmp/cache", "local-disk-or-code"],
    ["list --content-cache /tmp/cache", "local-disk-or-code"],
    ["plugin install https://github.com/databus23/helm-diff", "local-disk-or-code"],
    ["pull bitnami/nginx", "local-disk-or-code"],
    ["push nginx.tgz oci://registry", "local-disk-or-code"],
    ["package ./chart", "local-disk-or-code"],
    ["create chart", "local-disk-or-code"],
    ["lint ./chart", "local-disk-or-code"],
    ["dependency update ./chart", "local-disk-or-code"],
    ["verify nginx.tgz", "local-disk-or-code"],
    ["repo index ./charts", "local-disk-or-code"],
    ["diff upgrade web bitnami/nginx", "local-disk-or-code"],
    ["install web bitnami/nginx", "unparseable"],
    ["template web bitnami/nginx", "unparseable"],
    ["test web", "unparseable"],
    ["version", "unparseable"],
    ["env", "unparseable"],
    ["get all web", "unparseable"],
    ["get hooks web", "unparseable"],
    ["get web", "unparseable"],
    ["search hub nginx", "unparseable"],
    ["repo list", "unparseable"],
    ["repo update", "unparseable"],
    ["registry logout ghcr.io", "unparseable"],
    ["upgrade web bitnami/nginx --set a=1", "unparseable"],
    ["upgrade web bitnami/nginx --reuse-values=false --set a=1", "unparseable"],
    ["upgrade web bitnami/nginx --reuse-values --install", "unparseable"],
    ["upgrade web bitnami/nginx --reuse-values --version 15.0.0", "unparseable"],
    ["upgrade web bitnami/nginx --reuse-values --set-string a=1", "unparseable"],
    ["upgrade web --reuse-values", "unparseable"],
    ["upgrade web bitnami/nginx extra --reuse-values", "unparseable"],
    ["status", "unparseable"],
    ["status web api", "unparseable"],
    ["list web", "unparseable"],
    ["get values", "unparseable"],
    ["show values", "unparseable"],
    ["search repo a b", "unparseable"],
    ["rollback web two", "unparseable"],
    ["rollback web 2 3", "unparseable"],
    ["uninstall", "unparseable"],
    ["list --no-such-flag", "unparseable"],
    ["list -n", "unparseable"],
    ["", "unparseable"],
    ["status web -o json", "secret-output"],
    ["status web --output=yaml", "secret-output"],
    ["status web -ojson -n prod", "secret-output"],
  ])("helm %s is rejected by %s", (args, entry) => {
    expect(helmFloorEntryOf(args)).toBe(entry);
  });

  it.each<[string, FloorEntryId]>([
    ["list", "manifest"],
    ["upgrade web bitnami/nginx --reuse-values", "manifest"],
  ])("helm %s with a manifest is rejected by %s", (args, entry) => {
    expect(helmFloorEntryOf(args, { manifest: NAMESPACE })).toBe(entry);
  });

  it.each([
    "list --kube-insecure-skip-tls-verify=false",
    "list --debug --color never --qps 10 --burst-limit 50",
    "list -h",
    "upgrade web bitnami/nginx --reuse-values --dry-run",
    "upgrade web bitnami/nginx --reuse-values --dry-run=server",
    "upgrade web my-repo.example/nginx_chart --reuse-values",
    "uninstall web --dry-run --wait --cascade foreground",
    "rollback web --dry-run=server --cleanup-on-fail --force-replace --no-hooks --history-max 5",
    "status web -o table",
    "get manifest web",
  ])("helm %s passes the floor", (args) => {
    expect(helmFloorEntryOf(args)).toBe("passes");
  });

  it.each([
    ["install web bitnami/nginx", "Arguments the parser cannot place: helm install is not supported."],
    [
      "frobnicate web",
      "The user's disk and local code: frobnicate is not a helm verb, and helm would look for a plugin of that name.",
    ],
    ["list --kube-context prod", "Flags that change the cluster or the identity: --kube-context is never allowed."],
    [
      "status web -o json",
      "Output that prints Secret values around the redaction: helm status -o json prints the manifest of the release, " +
        "Secret values included, without revealSecrets; use -o table, or helm get manifest, whose Secret values are " +
        "redacted.",
    ],
    ["repo add bitnami https://charts.bitnami.com", "Credentials and configuration: helm repo add is never allowed."],
    [
      "upgrade web ./chart --reuse-values",
      "The user's disk and local code: ./chart is a local chart path or a chart URL; name a chart of a repository as <repository>/<chart>.",
    ],
    [
      "upgrade web bitnami/nginx --set a=1",
      "Arguments the parser cannot place: helm upgrade needs --reuse-values, so that it keeps the values of the release and changes only those that --set gives.",
    ],
    [
      "upgrade web bitnami/nginx --reuse-values --version 15.0.0",
      "Arguments the parser cannot place: --version is not a supported flag of helm upgrade; run it without --version.",
    ],
    ["list", "Manifests that do not parse or do not belong: helm list takes no manifest."],
  ])("explains why helm %s is rejected", (args, reason) => {
    const options = args === "list" ? { manifest: NAMESPACE } : {};
    expect(evaluateHelm(args, options)).toMatchObject({ kind: "floor", reason });
  });
});

describe("policy rules of helm", () => {
  it.each([
    ["status web -n prod", "deny", "helm status releases web -n prod"],
    ["status api -n prod", "ask", "helm status"],
    ["get values web", "alwaysAsk", "helm get *"],
    ["get notes web", "alwaysAsk", "helm get *"],
    ["show values bitnami/nginx", "allow", "helm show charts bitnami/*"],
    ["show values other/nginx", "ask", "helm show"],
    ["list -A", "allow", "helm list"],
  ])("the most specific rule decides helm %s", (args, level, pattern) => {
    const profile = profileOf(
      {
        helm: "allow",
        "helm status": "ask",
        "helm status releases web -n prod": "deny",
        "helm get *": "alwaysAsk",
        "helm list": "allow",
        "helm show charts bitnami/*": "allow",
        "helm show": "ask",
        "kubectl get": "deny",
      },
      "ask",
    );
    const result = evaluateHelm(args, { profile });
    if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
    expect([result.level, result.targets[0]?.rule?.pattern]).toEqual([level, pattern]);
  });

  it("does not match a helm invocation by a kubectl rule, nor the reverse", () => {
    const profile = profileOf({ "kubectl list": "deny", "helm get pods": "deny", "kubectl get *": "allow" }, "ask");
    expect(evaluateHelm("list", { profile })).toMatchObject({ level: "ask" });
    expect(decide("get pods", profile).level).toBe("allow");
  });
});

describe("the shipped profiles for helm", () => {
  it.each<[PolicyProfile, string, PolicyLevel]>([
    [READ_ONLY_PROFILE, "list -A", "allow"],
    [READ_ONLY_PROFILE, "status web", "allow"],
    [READ_ONLY_PROFILE, "history web", "allow"],
    [READ_ONLY_PROFILE, "get values web", "allow"],
    [READ_ONLY_PROFILE, "get manifest web", "allow"],
    [READ_ONLY_PROFILE, "get notes web", "allow"],
    [READ_ONLY_PROFILE, "show values bitnami/nginx", "allow"],
    [READ_ONLY_PROFILE, "search repo nginx", "allow"],
    [READ_ONLY_PROFILE, "rollback web", "deny"],
    [READ_ONLY_PROFILE, "upgrade web bitnami/nginx --reuse-values --set a=1", "deny"],
    [READ_ONLY_PROFILE, "uninstall web", "deny"],
    [STANDARD_PROFILE, "list", "allow"],
    [STANDARD_PROFILE, "get values web", "allow"],
    [STANDARD_PROFILE, "rollback web", "ask"],
    [STANDARD_PROFILE, "upgrade web bitnami/nginx --reuse-values --set a=1", "ask"],
    [STANDARD_PROFILE, "uninstall web", "alwaysAsk"],
    [PERMISSIVE_PROFILE, "history web", "allow"],
    [PERMISSIVE_PROFILE, "rollback web 2", "allow"],
    [PERMISSIVE_PROFILE, "upgrade web bitnami/nginx --reuse-values --set a=1", "allow"],
    [PERMISSIVE_PROFILE, "uninstall web api", "alwaysAsk"],
  ])("%s gives helm %s the level %s", (profile, args, level) => {
    expect(evaluateHelm(args, { profile })).toMatchObject({ kind: "policy", level });
  });
});

describe("the dry-run verbs of helm", () => {
  const helmDryRunVerbOf = (verb: string) => DRY_RUN_VERBS.helm.find((candidate) => candidate.verb === verb);

  it.each([
    ["upgrade web bitnami/nginx --reuse-values --set a=1", true],
    ["rollback web 2", false],
  ])("name the verb of helm %s, which accepts --dry-run=server", (args, acceptsYamlOutput) => {
    const result = evaluateHelm(`${args} --dry-run=server`);
    if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
    expect(helmDryRunVerbOf(result.targets[0]?.form.verb ?? "")?.acceptsYamlOutput).toBe(acceptsYamlOutput);
  });

  it.each(["list", "status web", "get values web", "uninstall web"])("leave out the verb of helm %s", (args) => {
    const result = evaluateHelm(args);
    if (result.kind !== "policy") throw new Error(`rejected by the floor: ${result.reason}`);
    expect(result.targets.some((target) => helmDryRunVerbOf(target.form.verb))).toBe(false);
  });
});
