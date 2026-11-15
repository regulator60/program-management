import { S0View } from "../../view";

export const metadata = { title: "S0 weekly review" };

export default function Page(props: PageProps<"/s0/[kind]/[name]">) {
  const scope = props.params.then(({ kind, name }) => `${kind}:${decodeURIComponent(name)}`);
  return <S0View scope={scope} />;
}
