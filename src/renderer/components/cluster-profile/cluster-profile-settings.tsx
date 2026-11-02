import { Renderer } from "@freelensapp/extensions";
import { ClusterProfilePicker } from "./cluster-profile-picker";

import type { ComponentProps } from "react";

const {
  Component: { SubTitle },
} = Renderer;

type EntitySettingViewProps = ComponentProps<Renderer.LensExtension["entitySettings"][number]["components"]["View"]>;

/** The Freelens AI tab of a cluster's settings: the policy profile of the cluster, whose id is the entity's id. */
export const ClusterProfileSettings = ({ entity }: EntitySettingViewProps) => (
  <section>
    <SubTitle title="Policy profile" id="freelens-ai-policy-profile" />
    <ClusterProfilePicker clusterId={entity.getId()} clusterName={entity.getName()} />
    <small className="hint">
      Decides which kubectl commands the agent runs on this cluster, which wait for your approval and which are denied.
      A change applies from the agent's next command. Edit the profiles in the Freelens AI preferences.
    </small>
  </section>
);
