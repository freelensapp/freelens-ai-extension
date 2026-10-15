import { type Common, Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../../../common/store";
import { FreeLensAiIcon } from "../freelens-ai-icon";
import { useMenuEntryHook } from "./menu-entry-hook";

const {
  Component: { MenuItem },
} = Renderer;

export interface MenuEntryProps extends Common.Types.KubeObjectMenuItemProps<Renderer.K8sApi.KubeEvent> {
  // The extension instance, handed over by the registration, which opens the
  // chat page.
  extension: Renderer.LensExtension;
}

export const MenuEntry = ({ object, extension }: MenuEntryProps) => {
  const preferencesStore: PreferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const menuEntryHook = useMenuEntryHook(preferencesStore, extension);

  return (
    <MenuItem hidden={!object.message} onClick={() => menuEntryHook.openTab(object.message ?? "-")}>
      <FreeLensAiIcon />
      <span className="title">Explain</span>
    </MenuItem>
  );
};
