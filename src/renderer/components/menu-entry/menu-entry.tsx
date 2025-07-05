import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../../../common/store";
import { FreelensAiIcon } from "../freelens-ai-icon";
import { useMenuEntryHook } from "./menu-entry-hook";

const {
  Component: { MenuItem },
} = Renderer;

type KubeObject = Renderer.K8sApi.KubeObject;
type KubeObjectMenuProps<TKubeObject extends KubeObject> = Renderer.Component.KubeObjectMenuProps<TKubeObject>;

export const MenuEntry = ({ object }: KubeObjectMenuProps<Renderer.K8sApi.KubeEvent>) => {
  const preferencesStore = PreferencesStore.getInstance<PreferencesStore>();
  const menuEntryHook = useMenuEntryHook(preferencesStore);

  return (
    <MenuItem hidden={!object.message} onClick={() => menuEntryHook.openTab(object.message ?? "-")}>
      <FreelensAiIcon />
      <span className="title">Explain</span>
    </MenuItem>
  );
};
