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

The Kubernetes Operator agent can perform the following actions:

- ✅ Create Pods
- ✅ Delete Pods
- ✅ Get Pods
- ✅ Create Deployments
- ✅ Delete Deployments
- ✅ Get Deployments
- ✅ Create Service
- ✅ Delete Service
- ✅ Get Services

🧠 Note: All actions are gated by human approval to ensure operational safety.
