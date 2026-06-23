# Base Agent for Freelens-AI 📡

The Base Agent for Freelens-AI is a multi-agent AI workflow designed to assist
users with Kubernetes-related tasks. It intelligently responds to user queries
and interacts with your cluster using a set of built-in tools — all with
optional human approval.

## Features 🛠️

Cluster Analyzer Scans a specified Kubernetes namespace for warning events,
providing clear explanations and actionable remedies for each issue.

Kubernetes Operator Executes basic Kubernetes operations (see tool list below)
with human-in-the-loop validation for safety and control.

Kubernetes Explainer Answers general questions about Kubernetes concepts,
objects, and best practices.

## Tools Available to the K8S Operator 🛠️ 

The Kubernetes Operator agent works on any resource kind — built-in kinds and
CRDs alike — and can perform the following actions:

- ✅ List, get, create, update, patch, and delete any Kubernetes resource
- ✅ Read pod container logs, including the previous instance, with a
  regular-expression filter
- ✅ Resize a running pod in place (`resize` subresource) or scale a workload
- ✅ Delete pods with eviction, force delete, or finalizer-clearing variants
- ✅ Rollout restart of workloads
- ✅ Read the Kubernetes server version
- ✅ Analyze warning events in a namespace

Read and analysis tools return trimmed output: `metadata.managedFields` is
stripped by default, and JSONPath-style field selectors can limit the result to
only the fields that matter.

🧠 Note: All write actions are gated by human approval to ensure operational
safety.
