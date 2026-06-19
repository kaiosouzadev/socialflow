type RouteContext<_Path extends string = string> = {
  params: Promise<Record<string, string>>;
};
