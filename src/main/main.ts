import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store/preferences-store";

export default class LensExtensionAiMain extends Main.LensExtension {
  async onActivate() {
    // @ts-ignore
    PreferencesStore.createInstance().loadExtension(this);
  }
}
