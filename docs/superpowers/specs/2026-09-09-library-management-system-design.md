# 图书管理系统设计文档

## 项目概述

设计一个标准图书借阅管理系统，支持图书管理、读者管理、借阅管理、罚款管理和统计报表功能。

**技术栈：**
- 后端：RuoYi-Cloud-Plus（Spring Cloud Alibaba + MyBatis-Plus + PostgreSQL）
- 前端：Vue 3 + Element Plus + TypeScript

**开发预估工时：** 80-120 小时

---

## 系统架构

### 核心业务实体

```
1. Book（图书）
   - id, isbn, title, author, publisher, category_id
   - publish_date, price, stock, available_stock
   - location, description, cover_image

2. Category（图书分类）
   - id, name, parent_id, sort

3. Reader（读者）
   - id, name, phone, email, card_number
   - status, max_borrow_count, current_borrow_count
   - create_time, update_time

4. BorrowRecord（借阅记录）
   - id, reader_id, book_id, borrow_date
   - due_date, return_date, actual_return_date
   - status, fine_amount

5. FineRecord（罚款记录）
   - id, reader_id, borrow_record_id
   - fine_amount, payment_status, payment_date
```

### 模块划分

```
library-system/
├── library-book          # 图书管理模块
├── library-reader        # 读者管理模块
├── library-borrow        # 借阅管理模块
└── library-report        # 统计报表模块
```

---

## 业务流程设计

### 1. 借书流程

```
读者请求借书
    ↓
检查读者状态（是否可借）
    ↓
检查图书库存（是否有货）
    ↓
创建借阅记录
    ↓
更新图书库存
    ↓
更新读者借阅数量
    ↓
返回借阅凭证
```

**业务规则：**
- 读者最多可借 N 本（配置项）
- 图书库存不足时拒绝借阅
- 读者有逾期未还书时禁止借阅
- 借阅期限默认 30 天

### 2. 还书流程

```
读者归还图书
    ↓
查找借阅记录
    ↓
检查是否逾期
    ↓
[逾期] 计算罚款 → 创建罚款记录
    ↓
更新借阅记录状态
    ↓
更新图书库存
    ↓
更新读者借阅数量
    ↓
[有罚款] 提示缴纳罚款
```

**业务规则：**
- 逾期罚款：0.1 元/天/本（可配置）
- 归还后库存自动增加
- 罚款未缴清前禁止借书

### 3. 续借流程

```
读者请求续借
    ↓
检查是否可续借
    ↓
[可续借] 更新归还日期
    ↓
[不可续借] 提示原因
```

**业务规则：**
- 每本书最多续借 1 次
- 续借延长 15 天
- 已逾期不可续借

### 4. 罚款缴纳流程

```
读者缴纳罚款
    ↓
检查罚款记录
    ↓
更新罚款状态
    ↓
解除借书限制
```

---

## Epic 与 Feature 划分

### Epic E1：图书管理

**Feature F1.1：图书信息管理**
- 图书录入
- 图书信息修改
- 图书删除
- 图书查询（支持 ISBN、书名、作者等）

**Feature F1.2：图书分类管理**
- 分类增删改查
- 分类树形结构

**Feature F1.3：库存管理**
- 库存数量维护
- 库存预警

---

### Epic E2：读者管理

**Feature F2.1：读者信息管理**
- 读者注册
- 信息修改
- 读者查询
- 读者状态管理（启用/禁用）

**Feature F2.2：借阅权限管理**
- 最大借阅数配置
- 借阅历史查看

---

### Epic E3：借阅管理

**Feature F3.1：借书功能**
- 借书操作
- 借书限制校验

**Feature F3.2：还书功能**
- 还书操作
- 逾期检测
- 罚款计算

**Feature F3.3：续借功能**
- 续借操作
- 续借限制

---

### Epic E4：罚款管理

**Feature F4.1：罚款记录管理**
- 罚款自动计算
- 罚款记录查询

**Feature F4.2：罚款缴纳**
- 罚款缴纳
- 缴纳状态管理

---

### Epic E5：统计报表

**Feature F5.1：借阅统计**
- 借阅趋势图
- 热门图书排行

**Feature F5.2：读者统计**
- 读者借阅排行
- 逾期统计

---

## 数据库设计

### 表结构设计

#### 1. library_book（图书表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| isbn | VARCHAR(20) | ISBN 号，唯一索引 |
| title | VARCHAR(200) | 书名 |
| author | VARCHAR(100) | 作者 |
| publisher | VARCHAR(100) | 出版社 |
| category_id | BIGINT | 分类 ID，外键 |
| publish_date | DATE | 出版日期 |
| price | DECIMAL(10,2) | 价格 |
| stock | INT | 总库存 |
| available_stock | INT | 可借库存 |
| location | VARCHAR(50) | 馆藏位置 |
| description | TEXT | 简介 |
| cover_image | VARCHAR(255) | 封面图片 URL |
| create_time | DATETIME | 创建时间 |
| update_time | DATETIME | 更新时间 |

**索引：**
- UNIQUE INDEX uk_isbn ON library_book(isbn)
- INDEX idx_category_id ON library_book(category_id)
- INDEX idx_title_author ON library_book(title, author)

#### 2. library_category（分类表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| name | VARCHAR(50) | 分类名称 |
| parent_id | BIGINT | 父分类 ID |
| sort | INT | 排序 |
| create_time | DATETIME | 创建时间 |

**索引：**
- INDEX idx_parent_id ON library_category(parent_id)

#### 3. library_reader（读者表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| name | VARCHAR(50) | 姓名 |
| phone | VARCHAR(20) | 手机号 |
| email | VARCHAR(100) | 邮箱 |
| card_number | VARCHAR(30) | 借书证号，唯一索引 |
| status | TINYINT | 状态（1:正常 0:禁用） |
| max_borrow_count | INT | 最大借阅数 |
| current_borrow_count | INT | 当前借阅数 |
| create_time | DATETIME | 创建时间 |
| update_time | DATETIME | 更新时间 |

**索引：**
- UNIQUE INDEX uk_card_number ON library_reader(card_number)
- INDEX idx_status ON library_reader(status)

#### 4. library_borrow_record（借阅记录表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| reader_id | BIGINT | 读者 ID，外键 |
| book_id | BIGINT | 图书 ID，外键 |
| borrow_date | DATETIME | 借阅日期 |
| due_date | DATETIME | 应还日期 |
| actual_return_date | DATETIME | 实际归还日期 |
| status | TINYINT | 状态（1:借阅中 2:已归还 3:逾期） |
| renew_count | INT | 续借次数 |
| fine_amount | DECIMAL(10,2) | 罚款金额 |
| create_time | DATETIME | 创建时间 |
| update_time | DATETIME | 更新时间 |

**索引：**
- INDEX idx_reader_status ON library_borrow_record(reader_id, status)
- INDEX idx_book_status ON library_borrow_record(book_id, status)
- INDEX idx_borrow_date ON library_borrow_record(borrow_date)

#### 5. library_fine_record（罚款记录表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| reader_id | BIGINT | 读者 ID |
| borrow_record_id | BIGINT | 借阅记录 ID |
| fine_amount | DECIMAL(10,2) | 罚款金额 |
| payment_status | TINYINT | 支付状态（0:未支付 1:已支付） |
| payment_date | DATETIME | 支付日期 |
| create_time | DATETIME | 创建时间 |

**索引：**
- INDEX idx_reader_payment ON library_fine_record(reader_id, payment_status)

---

## 技术约束

### 后端规范

1. 使用 RuoYi-Cloud-Plus 框架
2. MyBatis-Plus ORM，继承 BaseEntity
3. 统一返回格式 Result<T>
4. 分页使用 Page<T>
5. 异常使用 ServiceException

### 前端规范

1. Vue 3 Composition API
2. Element Plus 组件库
3. 使用 TypeScript
4. 表单验证使用 async-validator

### 数据库规范

1. 所有表使用 `library_` 前缀
2. 主键使用 BIGINT 自增
3. 必须包含 create_time 字段
4. 外键关系需要明确标注

### 接口规范

1. RESTful 风格
2. GET 查询，POST 新增，PUT 修改，DELETE 删除
3. 统一路径：`/library/模块/操作`

---

## 系统配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| max_borrow_count | 5 | 单个读者最大借阅数量 |
| borrow_period_days | 30 | 借阅期限（天） |
| renew_period_days | 15 | 续借延长时间（天） |
| max_renew_count | 1 | 最大续借次数 |
| fine_rate_per_day | 0.1 | 逾期罚款（元/天/本） |
| stock_warning_threshold | 5 | 库存预警阈值 |

---

## 非功能性需求

### 性能要求

- 图书查询响应时间 < 500ms
- 借还书操作响应时间 < 300ms
- 支持并发用户数 > 100

### 安全要求

- 借书证号加密存储
- 操作日志记录
- 权限控制（基于 RBAC）

### 可扩展性

- 支持未来添加预约功能
- 支持第三方系统对接
- 支持多馆分馆模式

---

## 实施建议

### 开发顺序

1. 数据库表创建
2. 图书管理模块（CRUD）
3. 读者管理模块（CRUD）
4. 借阅管理模块（核心业务）
5. 罚款管理模块
6. 统计报表模块

### 测试策略

- 单元测试覆盖核心业务逻辑
- 集成测试验证业务流程
- 性能测试验证并发能力

---

## 附录：业务状态机

### 图书状态

```
可借（available_stock > 0）
不可借（available_stock = 0）
```

### 借阅记录状态

```
借阅中 → 已归还
       → 逾期 → 已归还
```

### 罚款状态

```
未支付 → 已支付
```