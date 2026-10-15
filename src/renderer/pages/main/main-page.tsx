import { Chat } from "../../components/chat";
import { ApplicationContextProvider } from "../../context/application-context";
import styles from "./main-page.module.scss";

import type { Renderer } from "@freelensapp/extensions";

export interface MainPageProps {
  // The extension instance, handed over by the registration, which opens the
  // extension's preferences from the chat.
  extension: Renderer.LensExtension;
}

export const MainPage = ({ extension }: MainPageProps) => {
  return (
    <ApplicationContextProvider extension={extension}>
      <div className={styles.aiExtensionMainPage}>
        <Chat />
      </div>
    </ApplicationContextProvider>
  );
};
