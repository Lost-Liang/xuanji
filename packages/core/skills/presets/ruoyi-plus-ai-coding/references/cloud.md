# Cloud 约定

## 优先参考的代码来源

- `ruoyi-api/ruoyi-api-*/src/main/java/.../api/Remote*Service.java`
- `ruoyi-api/ruoyi-api-*/src/main/java/.../api/domain/**`
- `ruoyi-modules/*/src/main/java/.../dubbo/Remote*ServiceImpl.java`
- `ruoyi-auth/src/main/java/...`
- `ruoyi-gateway/src/main/java/.../filter/**`
- `ruoyi-common/ruoyi-common-dubbo/**`
- `ruoyi-common/ruoyi-common-seata/**`
- `script/config/nacos/*.yml`

## 服务边界

- 当前项目是 Cloud 拆分结构，服务间能力优先通过 `ruoyi-api-*` 暴露契约，不要跨模块直接注入对方 mapper、service 或 entity。
- `ruoyi-api-*` 只放远程接口、远程 BO/VO/domain、model、event、mock、stub 等契约对象；不要放业务实现、mapper、controller 或依赖具体业务模块。
- 远程接口命名沿用 `RemoteXxxService`，提供方实现命名沿用 `RemoteXxxServiceImpl` 并放在业务模块的 `dubbo` 包。
- 远程对象命名沿用 `RemoteXxxBo`、`RemoteXxxVo`、`RemoteXxx`，避免直接把内部 Entity 或内部管理端 VO 暴露成跨服务契约。
- 修改远程接口签名时必须同时检查所有 `@DubboReference` 调用点、`@DubboService` 实现、mock/stub、MapStruct 转换器和编译影响。

## Dubbo Provider

- 提供方类通常同时标注 `@RequiredArgsConstructor`、`@Service`、`@DubboService`，并实现 `ruoyi-api-*` 中的 `RemoteXxxService`。
- Provider 内部复用本模块 service/mapper，不绕过本模块已有权限、缓存、校验、事务和转换规则。
- 返回远程 VO/BO 时优先使用已有 convert 接口或 `MapstructUtils.convert(...)`，不要手写重复字段拷贝。
- 批量查询接口遇到空集合时优先返回 `List.of()`、`Map.of()` 或空字符串，避免无意义远程调用和 SQL。
- 登录、权限、字典、用户、部门、资源、消息、工作流等远程接口要保持稳定，因为它们常被 `auth`、`gateway`、`workflow`、公共 translation/log/service-impl 模块消费。

## Dubbo Consumer

- 消费方注入远程服务使用 `@DubboReference`，字段类型使用 `ruoyi-api-*` 的 `RemoteXxxService`。
- 可选或弱依赖调用按已有写法使用 `@DubboReference(mock = "true")` 或 `@DubboReference(stub = "true")`，并在 `ruoyi-api-*` 中提供 `RemoteXxxServiceMock` / `RemoteXxxServiceStub`。
- mock 用于服务调用异常后的降级返回，例如返回 `null`、`List.of()`、`StringUtils.EMPTY`；stub 用于本地包裹远程调用并吞掉非关键异常，例如消息推送未开启。
- 列表、翻译、流程候选人、消息推送等场景优先调用批量远程接口，避免在循环中逐条 Dubbo 调用。
- 远程调用失败是否抛出异常要按业务语义决定：登录、权限、注册等关键路径应失败；通知、推送、OSS URL 翻译等弱依赖可降级。

## 应用与依赖

- 需要 Dubbo provider 或 consumer 的应用启动类保持 `@EnableDubbo`，模块 pom 检查是否依赖 `ruoyi-common-dubbo`。
- 跨服务写入需要分布式事务时检查是否依赖 `ruoyi-common-seata`，并使用 `@GlobalTransactional(rollbackFor = Exception.class)`；单服务本地写入继续使用 `@Transactional`。
- `common-dubbo.yml` 是内置配置，注册中心走 Nacos，元数据中心走 Redis；不要直接改内置配置做业务定制，业务环境差异优先通过 Nacos 同名配置覆盖。
- 各应用 `application.yml` 通常导入 `optional:nacos:application-common.yml` 和 `optional:nacos:${spring.application.name}.yml`，新增应用或配置时保持这个结构。

## 数据权限与上下文

- Dubbo 消费端存在 `DubboDataPermissionFilter`，会透传 `DataPermissionHelper` 上下文；不要随意删除或绕过数据权限上下文。
- 远程 provider 内部查询仍按本模块 mapper/service 的数据权限规则执行。
- 确实需要系统级写入或登录记录更新时，按现有代码使用 `DataPermissionHelper.ignore(...)` 包裹最小范围。
- 涉及登录用户、租户、客户端、same-token、请求头透传时先查 `LoginHelper`、Gateway 过滤器和 common-satoken 现有实现。

## Gateway 与 Auth

- 认证中心位于 `ruoyi-auth`，网关位于 `ruoyi-gateway`；不要把 token 签发、客户端校验、网关白名单逻辑散落到普通业务模块。
- Gateway 的 `AuthFilter` 负责 Sa-Token 登录校验、客户端 ID 匹配、客户端访问路径/IP 白名单和 actuator Basic Auth。
- `ForwardAuthFilter` 负责透传 `X-Forwarded-Prefix` 和内部 same-token；新增网关过滤逻辑时注意 filter order 和 actuator 排除。
- 网关白名单、路由、鉴权、Nacos metadata 等配置优先放 Nacos 配置文件或已有 properties，不硬编码到业务 controller。
- 业务 controller 仍保留 `@SaCheckPermission`、`@SaCheckRole` 等权限注解，网关认证不替代业务权限。

## Seata 与跨服务副作用

- 同一个请求里同时修改本服务数据库并调用远程服务写入时，优先判断是否需要 `@GlobalTransactional`。
- 文件上传、头像更新、消息推送、工作流启动/完成等跨服务副作用要区分强一致与可降级副作用。
- 非关键消息推送可采用 stub/mock 降级；关键数据一致性不要用吞异常替代事务或补偿。

## 自检

- 是否误把内部 Entity/VO 暴露到 `ruoyi-api-*`。
- 是否同步修改了远程接口、provider、consumer、mock/stub、转换器和 pom 依赖。
- 是否避免了循环中的逐条 Dubbo 调用。
- 是否检查了 `@EnableDubbo`、`ruoyi-common-dubbo`、`ruoyi-common-seata`、Nacos 配置和 Gateway 白名单。
- 是否保留数据权限上下文透传、缓存失效、事务边界和异常语义。
