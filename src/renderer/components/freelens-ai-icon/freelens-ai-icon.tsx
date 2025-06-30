import { Renderer } from "@freelensapp/extensions";
import svgIcon from "../../icons/extension-icon.svg?raw";

const {
  Component: { Icon },
} = Renderer;

export const FreelensAiIcon = (props: Renderer.Component.IconProps) => {
  return <Icon {...props} svg={svgIcon} />;
};
