import { Chat } from "../../components/chat";
import { ApplicationContextProvider } from "../../context/application-context";
import styles from "./main-page.module.scss";

export const MainPage = () => {
  return (
    <ApplicationContextProvider>
      <div className={styles.aiExtensionMainPage}>
        <Chat />
      </div>
    </ApplicationContextProvider>
  );
};
