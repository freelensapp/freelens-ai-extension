import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store";

export default class LensExtensionAiMain extends Main.LensExtension {
  async onActivate() {
    PreferencesStore.createInstance().loadExtension(this);
  }
}
