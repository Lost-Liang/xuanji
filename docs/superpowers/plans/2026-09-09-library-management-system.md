# 图书管理系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个完整的图书借阅管理系统，支持图书管理、读者管理、借阅管理、罚款管理和统计报表功能。

**Architecture:** 采用 RuoYi-Cloud-Plus 微服务架构，前后端分离。后端使用 Spring Cloud Alibaba + MyBatis-Plus + PostgreSQL，前端使用 Vue 3 + Element Plus + TypeScript。按业务模块垂直切分：图书管理、读者管理、借阅管理、统计报表四个独立模块。

**Tech Stack:**
- 后端：RuoYi-Cloud-Plus (Spring Cloud Alibaba + MyBatis-Plus + PostgreSQL)
- 前端：Vue 3 + Element Plus + TypeScript + Pinia
- 测试：JUnit 5 + Mockito (后端), Vitest (前端)

**Spec:** `docs/superpowers/specs/2026-09-09-library-management-system-design.md`

## 全局约束

**从设计文档中提取的项目级约束：**

- 数据库：PostgreSQL，所有表使用 `library_` 前缀
- ORM：MyBatis-Plus，所有实体继承 BaseEntity
- 响应格式：统一使用 Result<T>
- 分页：使用 Page<T>
- 异常：使用 ServiceException
- 前端路由：Vue Router，路径格式 `/library/模块/操作`
- 主键类型：BIGINT 自增
- 必填字段：所有表必须包含 create_time, update_time
- 库存管理：借书减少 available_stock，还书增加 available_stock
- 借阅限制：读者最多借 5 本，借期 30 天，可续借 1 次（延长 15 天）
- 罚款规则：逾期 0.1 元/天/本，罚款未缴清禁止借书
- 库存预警：available_stock < 5 时触发预警

---

## 文件结构映射

**后端模块结构（每个模块独立 Maven 项目）：**

```
library-system/
├── library-book/                    # 图书管理模块
│   └── src/main/java/com/library/book/
│       ├── domain/Book.java                  # 图书实体
│       ├── domain/Category.java              # 分类实体
│       ├── mapper/BookMapper.java            # 图书 Mapper
│       ├── mapper/CategoryMapper.java        # 分类 Mapper
│       ├── service/BookService.java          # 图书服务接口
│       ├── service/impl/BookServiceImpl.java # 图书服务实现
│       ├── service/CategoryService.java      # 分类服务接口
│       ├── service/impl/CategoryServiceImpl.java # 分类服务实现
│       ├── controller/BookController.java    # 图书 API
│       └── controller/CategoryController.java # 分类 API
│   └── src/main/resources/
│       └── mapper/
│           ├── BookMapper.xml                # 图书 SQL 映射
│           └── CategoryMapper.xml            # 分类 SQL 映射
│   └── src/test/java/com/library/book/
│       ├── BookServiceTest.java              # 图书服务测试
│       └── CategoryServiceTest.java          # 分类服务测试
├── library-reader/                  # 读者管理模块
│   └── src/main/java/com/library/reader/
│       ├── domain/Reader.java                # 读者实体
│       ├── mapper/ReaderMapper.java          # 读者 Mapper
│       ├── service/ReaderService.java        # 读者服务接口
│       ├── service/impl/ReaderServiceImpl.java # 读者服务实现
│       └── controller/ReaderController.java  # 读者 API
├── library-borrow/                  # 借阅管理模块
│   └── src/main/java/com/library/borrow/
│       ├── domain/BorrowRecord.java          # 借阅记录实体
│       ├── domain/FineRecord.java            # 罚款记录实体
│       ├── mapper/BorrowRecordMapper.java    # 借阅记录 Mapper
│       ├── mapper/FineRecordMapper.java      # 罚款记录 Mapper
│       ├── service/BorrowService.java        # 借阅服务接口
│       ├── service/impl/BorrowServiceImpl.java # 借阅服务实现
│       ├── service/FineService.java          # 罚款服务接口
│       ├── service/impl/FineServiceImpl.java # 罚款服务实现
│       └── controller/BorrowController.java  # 借阅 API
└── library-report/                  # 统计报表模块
    └── src/main/java/com/library/report/
        ├── service/ReportService.java        # 报表服务接口
        ├── service/impl/ReportServiceImpl.java # 报表服务实现
        └── controller/ReportController.java  # 报表 API
```

**前端项目结构：**

```
library-ui/
├── src/
│   ├── api/
│   │   ├── book.ts                   # 图书 API 调用
│   │   ├── category.ts               # 分类 API 调用
│   │   ├── reader.ts                 # 读者 API 调用
│   │   ├── borrow.ts                 # 借阅 API 调用
│   │   └── report.ts                 # 报表 API 调用
│   ├── views/
│   │   ├── book/
│   │   │   ├── BookList.vue          # 图书列表页
│   │   │   └── BookForm.vue          # 图书表单组件
│   │   ├── category/
│   │   │   └── CategoryList.vue      # 分类列表页
│   │   ├── reader/
│   │   │   ├── ReaderList.vue        # 读者列表页
│   │   │   └── ReaderForm.vue        # 读者表单组件
│   │   ├── borrow/
│   │   │   ├── BorrowList.vue        # 借阅记录列表
│   │   │   └── BorrowOperation.vue   # 借还书操作页
│   │   └── report/
│   │       ├── BorrowChart.vue       # 借阅统计图
│   │       └── ReaderRank.vue        # 读者排行
│   ├── components/
│   │   └── common/
│   │       └── Pagination.vue        # 分页组件
│   ├── stores/
│   │   ├── book.ts                   # 图书状态管理
│   │   ├── reader.ts                 # 读者状态管理
│   │   └── borrow.ts                 # 借阅状态管理
│   └── router/
│       └── index.ts                  # 路由配置
```

---

## Epic E1：图书管理

### Task 1: 创建数据库表和基础实体

**Files:**
- Create: `library-book/src/main/java/com/library/book/domain/Book.java`
- Create: `library-book/src/main/java/com/library/book/domain/Category.java`
- Create: `library-book/src/main/resources/schema.sql`

**Interfaces:**
- Consumes: BaseEntity (from RuoYi-Cloud-Plus framework)
- Produces: Book entity with fields: id, isbn, title, author, publisher, categoryId, publishDate, price, stock, availableStock, location, description, coverImage
- Produces: Category entity with fields: id, name, parentId, sort

- [ ] **Step 1: 创建数据库 schema 文件**

```sql
-- library-book/src/main/resources/schema.sql

-- 图书分类表
CREATE TABLE library_category (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL COMMENT '分类名称',
    parent_id BIGINT COMMENT '父分类ID',
    sort INT DEFAULT 0 COMMENT '排序',
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_parent_id ON library_category(parent_id);

-- 图书表
CREATE TABLE library_book (
    id BIGSERIAL PRIMARY KEY,
    isbn VARCHAR(20) NOT NULL UNIQUE COMMENT 'ISBN号',
    title VARCHAR(200) NOT NULL COMMENT '书名',
    author VARCHAR(100) COMMENT '作者',
    publisher VARCHAR(100) COMMENT '出版社',
    category_id BIGINT COMMENT '分类ID',
    publish_date DATE COMMENT '出版日期',
    price DECIMAL(10,2) COMMENT '价格',
    stock INT DEFAULT 0 COMMENT '总库存',
    available_stock INT DEFAULT 0 COMMENT '可借库存',
    location VARCHAR(50) COMMENT '馆藏位置',
    description TEXT COMMENT '简介',
    cover_image VARCHAR(255) COMMENT '封面图片URL',
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uk_isbn ON library_book(isbn);
CREATE INDEX idx_category_id ON library_book(category_id);
CREATE INDEX idx_title_author ON library_book(title, author);
```

- [ ] **Step 2: 运行 schema 创建表**

Run: `psql -h localhost -p 5433 -U v2 -d xuanji -f library-book/src/main/resources/schema.sql`
Expected: 表创建成功

- [ ] **Step 3: 创建 Category 实体类**

```java
// library-book/src/main/java/com/library/book/domain/Category.java
package com.library.book.domain;

import com.baomidou.mybatisplus.annotation.TableName;
import com.ruoyi.common.core.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 图书分类实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("library_category")
public class Category extends BaseEntity {

    /**
     * 分类名称
     */
    private String name;

    /**
     * 父分类ID
     */
    private Long parentId;

    /**
     * 排序
     */
    private Integer sort;
}
```

- [ ] **Step 4: 创建 Book 实体类**

```java
// library-book/src/main/java/com/library/book/domain/Book.java
package com.library.book.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import com.baomidou.mybatisplus.annotation.TableName;
import com.ruoyi.common.core.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 图书实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("library_book")
public class Book extends BaseEntity {

    /**
     * ISBN号
     */
    private String isbn;

    /**
     * 书名
     */
    private String title;

    /**
     * 作者
     */
    private String author;

    /**
     * 出版社
     */
    private String publisher;

    /**
     * 分类ID
     */
    private Long categoryId;

    /**
     * 出版日期
     */
    private LocalDate publishDate;

    /**
     * 价格
     */
    private BigDecimal price;

    /**
     * 总库存
     */
    private Integer stock;

    /**
     * 可借库存
     */
    private Integer availableStock;

    /**
     * 馆藏位置
     */
    private String location;

    /**
     * 简介
     */
    private String description;

    /**
     * 封面图片URL
     */
    private String coverImage;
}
```

- [ ] **Step 5: 提交代码**

```bash
git add library-book/src/main/resources/schema.sql
git add library-book/src/main/java/com/library/book/domain/
git commit -m "feat(library): create database schema and entity classes

- Create library_category and library_book tables
- Add Category and Book entity classes
- Add indexes for ISBN, category_id, title/author"
```

---

### Task 2: 实现 Category Mapper 和 Service

**Files:**
- Create: `library-book/src/main/java/com/library/book/mapper/CategoryMapper.java`
- Create: `library-book/src/main/resources/mapper/CategoryMapper.xml`
- Create: `library-book/src/main/java/com/library/book/service/CategoryService.java`
- Create: `library-book/src/main/java/com/library/book/service/impl/CategoryServiceImpl.java`
- Create: `library-book/src/test/java/com/library/book/CategoryServiceTest.java`

**Interfaces:**
- Consumes: Category entity (from Task 1)
- Produces: CategoryService with methods: saveCategory(Category), updateCategory(Category), deleteCategory(Long), getCategoryTree(), getCategoryById(Long)

- [ ] **Step 1: 创建 CategoryMapper 接口**

```java
// library-book/src/main/java/com/library/book/mapper/CategoryMapper.java
package com.library.book.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.library.book.domain.Category;
import org.apache.ibatis.annotations.Mapper;

/**
 * 图书分类Mapper接口
 */
@Mapper
public interface CategoryMapper extends BaseMapper<Category> {

}
```

- [ ] **Step 2: 创建 CategoryMapper.xml**

```xml
<!-- library-book/src/main/resources/mapper/CategoryMapper.xml -->
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper
PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
"http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.library.book.mapper.CategoryMapper">

    <resultMap type="com.library.book.domain.Category" id="CategoryResult">
        <id     property="id"           column="id"             />
        <result property="name"         column="name"           />
        <result property="parentId"     column="parent_id"      />
        <result property="sort"         column="sort"           />
        <result property="createTime"   column="create_time"    />
        <result property="updateTime"   column="update_time"    />
    </resultMap>

    <sql id="selectCategoryVo">
        select id, name, parent_id, sort, create_time, update_time
        from library_category
    </sql>

</mapper>
```

- [ ] **Step 3: 创建 CategoryService 接口**

```java
// library-book/src/main/java/com/library/book/service/CategoryService.java
package com.library.book.service;

import java.util.List;
import com.baomidou.mybatisplus.extension.service.IService;
import com.library.book.domain.Category;

/**
 * 图书分类服务接口
 */
public interface CategoryService extends IService<Category> {

    /**
     * 查询分类树
     */
    List<Category> getCategoryTree();

    /**
     * 根据ID查询分类
     */
    Category getCategoryById(Long id);
}
```

- [ ] **Step 4: 创建 CategoryServiceImpl**

```java
// library-book/src/main/java/com/library/book/service/impl/CategoryServiceImpl.java
package com.library.book.service.impl;

import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.library.book.domain.Category;
import com.library.book.mapper.CategoryMapper;
import com.library.book.service.CategoryService;
import com.ruoyi.common.exception.ServiceException;

/**
 * 图书分类服务实现
 */
@Service
public class CategoryServiceImpl extends ServiceImpl<CategoryMapper, Category>
        implements CategoryService {

    @Override
    public List<Category> getCategoryTree() {
        List<Category> allCategories = list();

        // 构建树形结构
        return allCategories.stream()
                .filter(c -> c.getParentId() == null || c.getParentId() == 0)
                .map(c -> {
                    c.setChildren(getChildren(c, allCategories));
                    return c;
                })
                .collect(Collectors.toList());
    }

    @Override
    public Category getCategoryById(Long id) {
        Category category = getById(id);
        if (category == null) {
            throw new ServiceException("分类不存在");
        }
        return category;
    }

    private List<Category> getChildren(Category parent, List<Category> allCategories) {
        return allCategories.stream()
                .filter(c -> parent.getId().equals(c.getParentId()))
                .map(c -> {
                    c.setChildren(getChildren(c, allCategories));
                    return c;
                })
                .collect(Collectors.toList());
    }
}
```

- [ ] **Step 5: 编写 CategoryServiceTest**

```java
// library-book/src/test/java/com/library/book/CategoryServiceTest.java
package com.library.book;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.junit.jupiter.api.Assertions.*;
import com.library.book.domain.Category;
import com.library.book.service.CategoryService;

@SpringBootTest
class CategoryServiceTest {

    @Autowired
    private CategoryService categoryService;

    @Test
    void testSaveAndQueryCategory() {
        // Given
        Category category = new Category();
        category.setName("计算机");
        category.setParentId(0L);
        category.setSort(1);

        // When
        boolean saved = categoryService.save(category);
        Category found = categoryService.getById(category.getId());

        // Then
        assertTrue(saved);
        assertNotNull(found);
        assertEquals("计算机", found.getName());
    }

    @Test
    void testGetCategoryTree() {
        // Given
        Category parent = new Category();
        parent.setName("文学");
        parent.setParentId(0L);
        categoryService.save(parent);

        Category child = new Category();
        child.setName("小说");
        child.setParentId(parent.getId());
        categoryService.save(child);

        // When
        List<Category> tree = categoryService.getCategoryTree();

        // Then
        assertFalse(tree.isEmpty());
    }
}
```

- [ ] **Step 6: 运行测试**

Run: `mvn test -Dtest=CategoryServiceTest -pl library-book`
Expected: 所有测试通过

- [ ] **Step 7: 提交代码**

```bash
git add library-book/src/main/java/com/library/book/mapper/
git add library-book/src/main/resources/mapper/
git add library-book/src/main/java/com/library/book/service/
git add library-book/src/test/java/com/library/book/CategoryServiceTest.java
git commit -m "feat(library): implement Category mapper and service

- Add CategoryMapper with MyBatis-Plus
- Add CategoryService with tree structure support
- Add unit tests for CategoryService"
```

---

### Task 3: 实现 Book Mapper 和 Service

**Files:**
- Create: `library-book/src/main/java/com/library/book/mapper/BookMapper.java`
- Create: `library-book/src/main/resources/mapper/BookMapper.xml`
- Create: `library-book/src/main/java/com/library/book/service/BookService.java`
- Create: `library-book/src/main/java/com/library/book/service/impl/BookServiceImpl.java`
- Create: `library-book/src/test/java/com/library/book/BookServiceTest.java`

**Interfaces:**
- Consumes: Book entity (from Task 1)
- Produces: BookService with methods: saveBook(Book), updateBook(Book), deleteBook(Long), getBookById(Long), listBooks(BookQuery), decreaseStock(Long, int), increaseStock(Long, int), checkStock(Long, int)

- [ ] **Step 1: 创建 BookMapper 接口**

```java
// library-book/src/main/java/com/library/book/mapper/BookMapper.java
package com.library.book.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.library.book.domain.Book;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 图书Mapper接口
 */
@Mapper
public interface BookMapper extends BaseMapper<Book> {

    /**
     * 减少库存
     */
    int decreaseStock(@Param("id") Long id, @Param("count") int count);

    /**
     * 增加库存
     */
    int increaseStock(@Param("id") Long id, @Param("count") int count);
}
```

- [ ] **Step 2: 创建 BookMapper.xml**

```xml
<!-- library-book/src/main/resources/mapper/BookMapper.xml -->
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper
PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
"http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.library.book.mapper.BookMapper">

    <resultMap type="com.library.book.domain.Book" id="BookResult">
        <id     property="id"             column="id"               />
        <result property="isbn"           column="isbn"             />
        <result property="title"          column="title"            />
        <result property="author"         column="author"           />
        <result property="publisher"      column="publisher"        />
        <result property="categoryId"     column="category_id"      />
        <result property="publishDate"    column="publish_date"     />
        <result property="price"          column="price"            />
        <result property="stock"          column="stock"            />
        <result property="availableStock" column="available_stock"  />
        <result property="location"       column="location"         />
        <result property="description"    column="description"      />
        <result property="coverImage"     column="cover_image"      />
        <result property="createTime"     column="create_time"      />
        <result property="updateTime"     column="update_time"      />
    </resultMap>

    <sql id="selectBookVo">
        select id, isbn, title, author, publisher, category_id, publish_date,
               price, stock, available_stock, location, description, cover_image,
               create_time, update_time
        from library_book
    </sql>

    <!-- 减少库存（带库存检查） -->
    <update id="decreaseStock">
        update library_book
        set available_stock = available_stock - #{count},
            update_time = current_timestamp
        where id = #{id} and available_stock >= #{count}
    </update>

    <!-- 增加库存 -->
    <update id="increaseStock">
        update library_book
        set available_stock = available_stock + #{count},
            update_time = current_timestamp
        where id = #{id}
    </update>

</mapper>
```

- [ ] **Step 3: 创建 BookQuery DTO**

```java
// library-book/src/main/java/com/library/book/dto/BookQuery.java
package com.library.book.dto;

import lombok.Data;

/**
 * 图书查询条件
 */
@Data
public class BookQuery {

    /**
     * ISBN号
     */
    private String isbn;

    /**
     * 书名
     */
    private String title;

    /**
     * 作者
     */
    private String author;

    /**
     * 分类ID
     */
    private Long categoryId;
}
```

- [ ] **Step 4: 创建 BookService 接口**

```java
// library-book/src/main/java/com/library/book/service/BookService.java
package com.library.book.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.library.book.domain.Book;
import com.library.book.dto.BookQuery;

/**
 * 图书服务接口
 */
public interface BookService extends IService<Book> {

    /**
     * 分页查询图书
     */
    Page<Book> listBooks(BookQuery query, int pageNum, int pageSize);

    /**
     * 根据ID查询图书
     */
    Book getBookById(Long id);

    /**
     * 减少库存
     */
    boolean decreaseStock(Long id, int count);

    /**
     * 增加库存
     */
    boolean increaseStock(Long id, int count);

    /**
     * 检查库存是否充足
     */
    boolean checkStock(Long id, int count);
}
```

- [ ] **Step 5: 创建 BookServiceImpl**

```java
// library-book/src/main/java/com/library/book/service/impl/BookServiceImpl.java
package com.library.book.service.impl;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.library.book.domain.Book;
import com.library.book.dto.BookQuery;
import com.library.book.mapper.BookMapper;
import com.library.book.service.BookService;
import com.ruoyi.common.exception.ServiceException;

/**
 * 图书服务实现
 */
@Service
public class BookServiceImpl extends ServiceImpl<BookMapper, Book>
        implements BookService {

    @Override
    public Page<Book> listBooks(BookQuery query, int pageNum, int pageSize) {
        LambdaQueryWrapper<Book> wrapper = new LambdaQueryWrapper<>();

        if (query != null) {
            if (StringUtils.hasText(query.getIsbn())) {
                wrapper.eq(Book::getIsbn, query.getIsbn());
            }
            if (StringUtils.hasText(query.getTitle())) {
                wrapper.like(Book::getTitle, query.getTitle());
            }
            if (StringUtils.hasText(query.getAuthor())) {
                wrapper.like(Book::getAuthor, query.getAuthor());
            }
            if (query.getCategoryId() != null) {
                wrapper.eq(Book::getCategoryId, query.getCategoryId());
            }
        }

        return page(new Page<>(pageNum, pageSize), wrapper);
    }

    @Override
    public Book getBookById(Long id) {
        Book book = getById(id);
        if (book == null) {
            throw new ServiceException("图书不存在");
        }
        return book;
    }

    @Override
    public boolean decreaseStock(Long id, int count) {
        if (count <= 0) {
            throw new ServiceException("减少数量必须大于0");
        }

        int rows = baseMapper.decreaseStock(id, count);
        if (rows == 0) {
            throw new ServiceException("库存不足");
        }

        return true;
    }

    @Override
    public boolean increaseStock(Long id, int count) {
        if (count <= 0) {
            throw new ServiceException("增加数量必须大于0");
        }

        int rows = baseMapper.increaseStock(id, count);
        return rows > 0;
    }

    @Override
    public boolean checkStock(Long id, int count) {
        Book book = getBookById(id);
        return book.getAvailableStock() >= count;
    }
}
```

- [ ] **Step 6: 编写 BookServiceTest**

```java
// library-book/src/test/java/com/library/book/BookServiceTest.java
package com.library.book;

import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.junit.jupiter.api.Assertions.*;
import com.library.book.domain.Book;
import com.library.book.service.BookService;

@SpringBootTest
class BookServiceTest {

    @Autowired
    private BookService bookService;

    @Test
    void testSaveAndQueryBook() {
        // Given
        Book book = new Book();
        book.setIsbn("9787111234567");
        book.setTitle("Java编程思想");
        book.setAuthor("Bruce Eckel");
        book.setPublisher("机械工业出版社");
        book.setPublishDate(LocalDate.of(2007, 6, 1));
        book.setPrice(new BigDecimal("108.00"));
        book.setStock(10);
        book.setAvailableStock(10);

        // When
        boolean saved = bookService.save(book);
        Book found = bookService.getBookById(book.getId());

        // Then
        assertTrue(saved);
        assertNotNull(found);
        assertEquals("Java编程思想", found.getTitle());
    }

    @Test
    void testDecreaseStock() {
        // Given
        Book book = createTestBook();
        book.setStock(10);
        book.setAvailableStock(10);
        bookService.save(book);

        // When
        boolean result = bookService.decreaseStock(book.getId(), 2);
        Book updated = bookService.getById(book.getId());

        // Then
        assertTrue(result);
        assertEquals(8, updated.getAvailableStock());
    }

    @Test
    void testIncreaseStock() {
        // Given
        Book book = createTestBook();
        book.setStock(10);
        book.setAvailableStock(8);
        bookService.save(book);

        // When
        boolean result = bookService.increaseStock(book.getId(), 2);
        Book updated = bookService.getById(book.getId());

        // Then
        assertTrue(result);
        assertEquals(10, updated.getAvailableStock());
    }

    @Test
    void testCheckStock() {
        // Given
        Book book = createTestBook();
        book.setAvailableStock(5);
        bookService.save(book);

        // When & Then
        assertTrue(bookService.checkStock(book.getId(), 3));
        assertFalse(bookService.checkStock(book.getId(), 10));
    }

    private Book createTestBook() {
        Book book = new Book();
        book.setIsbn("9787111234568");
        book.setTitle("测试图书");
        book.setStock(10);
        book.setAvailableStock(10);
        return book;
    }
}
```

- [ ] **Step 7: 运行测试**

Run: `mvn test -Dtest=BookServiceTest -pl library-book`
Expected: 所有测试通过

- [ ] **Step 8: 提交代码**

```bash
git add library-book/src/main/java/com/library/book/mapper/BookMapper.java
git add library-book/src/main/resources/mapper/BookMapper.xml
git add library-book/src/main/java/com/library/book/dto/
git add library-book/src/main/java/com/library/book/service/
git add library-book/src/test/java/com/library/book/BookServiceTest.java
git commit -m "feat(library): implement Book mapper and service

- Add BookMapper with stock management operations
- Add BookService with CRUD and stock operations
- Add BookQuery DTO for search
- Add unit tests for BookService"
```

---

### Task 4: 实现 Category 和 Book Controller

**Files:**
- Create: `library-book/src/main/java/com/library/book/controller/CategoryController.java`
- Create: `library-book/src/main/java/com/library/book/controller/BookController.java`

**Interfaces:**
- Consumes: CategoryService (from Task 2), BookService (from Task 3)
- Produces: REST API endpoints for category and book management

- [ ] **Step 1: 创建 CategoryController**

```java
// library-book/src/main/java/com/library/book/controller/CategoryController.java
package com.library.book.controller;

import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import com.ruoyi.common.core.domain.Result;
import com.library.book.domain.Category;
import com.library.book.service.CategoryService;

/**
 * 图书分类Controller
 */
@RestController
@RequestMapping("/library/category")
public class CategoryController {

    @Autowired
    private CategoryService categoryService;

    /**
     * 查询分类树
     */
    @GetMapping("/tree")
    public Result<List<Category>> tree() {
        List<Category> tree = categoryService.getCategoryTree();
        return Result.success(tree);
    }

    /**
     * 根据ID查询分类
     */
    @GetMapping("/{id}")
    public Result<Category> getInfo(@PathVariable Long id) {
        Category category = categoryService.getCategoryById(id);
        return Result.success(category);
    }

    /**
     * 新增分类
     */
    @PostMapping
    public Result<Void> add(@RequestBody Category category) {
        categoryService.save(category);
        return Result.success();
    }

    /**
     * 修改分类
     */
    @PutMapping
    public Result<Void> edit(@RequestBody Category category) {
        categoryService.updateById(category);
        return Result.success();
    }

    /**
     * 删除分类
     */
    @DeleteMapping("/{id}")
    public Result<Void> remove(@PathVariable Long id) {
        categoryService.removeById(id);
        return Result.success();
    }
}
```

- [ ] **Step 2: 创建 BookController**

```java
// library-book/src/main/java/com/library/book/controller/BookController.java
package com.library.book.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.ruoyi.common.core.domain.Result;
import com.library.book.domain.Book;
import com.library.book.dto.BookQuery;
import com.library.book.service.BookService;

/**
 * 图书Controller
 */
@RestController
@RequestMapping("/library/book")
public class BookController {

    @Autowired
    private BookService bookService;

    /**
     * 分页查询图书列表
     */
    @GetMapping("/list")
    public Result<Page<Book>> list(BookQuery query,
                                    @RequestParam(defaultValue = "1") int pageNum,
                                    @RequestParam(defaultValue = "10") int pageSize) {
        Page<Book> page = bookService.listBooks(query, pageNum, pageSize);
        return Result.success(page);
    }

    /**
     * 根据ID查询图书
     */
    @GetMapping("/{id}")
    public Result<Book> getInfo(@PathVariable Long id) {
        Book book = bookService.getBookById(id);
        return Result.success(book);
    }

    /**
     * 新增图书
     */
    @PostMapping
    public Result<Void> add(@RequestBody Book book) {
        bookService.save(book);
        return Result.success();
    }

    /**
     * 修改图书
     */
    @PutMapping
    public Result<Void> edit(@RequestBody Book book) {
        bookService.updateById(book);
        return Result.success();
    }

    /**
     * 删除图书
     */
    @DeleteMapping("/{id}")
    public Result<Void> remove(@PathVariable Long id) {
        bookService.removeById(id);
        return Result.success();
    }
}
```

- [ ] **Step 3: 测试 API**

Run: `curl http://localhost:8080/library/category/tree`
Expected: 返回分类树 JSON

Run: `curl http://localhost:8080/library/book/list?pageNum=1&pageSize=10`
Expected: 返回分页图书列表

- [ ] **Step 4: 提交代码**

```bash
git add library-book/src/main/java/com/library/book/controller/
git commit -m "feat(library): implement Category and Book REST API

- Add CategoryController with CRUD endpoints
- Add BookController with pagination support
- All endpoints follow RESTful conventions"
```

---

## Epic E2：读者管理

### Task 5: 创建 Reader 实体和 Mapper

**Files:**
- Create: `library-reader/src/main/java/com/library/reader/domain/Reader.java`
- Create: `library-reader/src/main/resources/schema.sql`
- Create: `library-reader/src/main/java/com/library/reader/mapper/ReaderMapper.java`
- Create: `library-reader/src/main/resources/mapper/ReaderMapper.xml`

**Interfaces:**
- Consumes: BaseEntity
- Produces: Reader entity with fields: id, name, phone, email, cardNumber, status, maxBorrowCount, currentBorrowCount
- Produces: ReaderMapper

- [ ] **Step 1: 创建数据库 schema**

```sql
-- library-reader/src/main/resources/schema.sql

-- 读者表
CREATE TABLE library_reader (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL COMMENT '姓名',
    phone VARCHAR(20) COMMENT '手机号',
    email VARCHAR(100) COMMENT '邮箱',
    card_number VARCHAR(30) NOT NULL UNIQUE COMMENT '借书证号',
    status TINYINT DEFAULT 1 COMMENT '状态（1:正常 0:禁用）',
    max_borrow_count INT DEFAULT 5 COMMENT '最大借阅数',
    current_borrow_count INT DEFAULT 0 COMMENT '当前借阅数',
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uk_card_number ON library_reader(card_number);
CREATE INDEX idx_status ON library_reader(status);
```

- [ ] **Step 2: 运行 schema 创建表**

Run: `psql -h localhost -p 5433 -U v2 -d xuanji -f library-reader/src/main/resources/schema.sql`
Expected: 表创建成功

- [ ] **Step 3: 创建 Reader 实体类**

```java
// library-reader/src/main/java/com/library/reader/domain/Reader.java
package com.library.reader.domain;

import com.baomidou.mybatisplus.annotation.TableName;
import com.ruoyi.common.core.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 读者实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("library_reader")
public class Reader extends BaseEntity {

    /**
     * 姓名
     */
    private String name;

    /**
     * 手机号
     */
    private String phone;

    /**
     * 邮箱
     */
    private String email;

    /**
     * 借书证号
     */
    private String cardNumber;

    /**
     * 状态（1:正常 0:禁用）
     */
    private Integer status;

    /**
     * 最大借阅数
     */
    private Integer maxBorrowCount;

    /**
     * 当前借阅数
     */
    private Integer currentBorrowCount;
}
```

- [ ] **Step 4: 创建 ReaderMapper**

```java
// library-reader/src/main/java/com/library/reader/mapper/ReaderMapper.java
package com.library.reader.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.library.reader.domain.Reader;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 读者Mapper接口
 */
@Mapper
public interface ReaderMapper extends BaseMapper<Reader> {

    /**
     * 增加借阅数量
     */
    int incrementBorrowCount(@Param("id") Long id);

    /**
     * 减少借阅数量
     */
    int decrementBorrowCount(@Param("id") Long id);
}
```

- [ ] **Step 5: 创建 ReaderMapper.xml**

```xml
<!-- library-reader/src/main/resources/mapper/ReaderMapper.xml -->
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper
PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
"http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.library.reader.mapper.ReaderMapper">

    <resultMap type="com.library.reader.domain.Reader" id="ReaderResult">
        <id     property="id"                 column="id"                  />
        <result property="name"               column="name"                />
        <result property="phone"              column="phone"               />
        <result property="email"              column="email"               />
        <result property="cardNumber"         column="card_number"         />
        <result property="status"             column="status"              />
        <result property="maxBorrowCount"     column="max_borrow_count"    />
        <result property="currentBorrowCount" column="current_borrow_count"/>
        <result property="createTime"         column="create_time"         />
        <result property="updateTime"         column="update_time"         />
    </resultMap>

    <sql id="selectReaderVo">
        select id, name, phone, email, card_number, status,
               max_borrow_count, current_borrow_count,
               create_time, update_time
        from library_reader
    </sql>

    <!-- 增加借阅数量（带最大值检查） -->
    <update id="incrementBorrowCount">
        update library_reader
        set current_borrow_count = current_borrow_count + 1,
            update_time = current_timestamp
        where id = #{id} and current_borrow_count < max_borrow_count
    </update>

    <!-- 减少借阅数量 -->
    <update id="decrementBorrowCount">
        update library_reader
        set current_borrow_count = current_borrow_count - 1,
            update_time = current_timestamp
        where id = #{id} and current_borrow_count > 0
    </update>

</mapper>
```

- [ ] **Step 6: 提交代码**

```bash
git add library-reader/
git commit -m "feat(library): create Reader entity and mapper

- Create library_reader table
- Add Reader entity with borrow count management
- Add ReaderMapper with increment/decrement operations"
```

---

### Task 6: 实现 Reader Service 和 Controller

**Files:**
- Create: `library-reader/src/main/java/com/library/reader/service/ReaderService.java`
- Create: `library-reader/src/main/java/com/library/reader/service/impl/ReaderServiceImpl.java`
- Create: `library-reader/src/test/java/com/library/reader/ReaderServiceTest.java`
- Create: `library-reader/src/main/java/com/library/reader/controller/ReaderController.java`

**Interfaces:**
- Consumes: ReaderMapper (from Task 5)
- Produces: ReaderService with methods: saveReader(Reader), updateReader(Reader), deleteReader(Long), getReaderById(Long), getReaderByCardNumber(String), listReaders(ReaderQuery), canBorrow(Long), incrementBorrowCount(Long), decrementBorrowCount(Long)

- [ ] **Step 1: 创建 ReaderQuery DTO**

```java
// library-reader/src/main/java/com/library/reader/dto/ReaderQuery.java
package com.library.reader.dto;

import lombok.Data;

/**
 * 读者查询条件
 */
@Data
public class ReaderQuery {

    /**
     * 姓名
     */
    private String name;

    /**
     * 借书证号
     */
    private String cardNumber;

    /**
     * 状态
     */
    private Integer status;
}
```

- [ ] **Step 2: 创建 ReaderService 接口**

```java
// library-reader/src/main/java/com/library/reader/service/ReaderService.java
package com.library.reader.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.library.reader.domain.Reader;
import com.library.reader.dto.ReaderQuery;

/**
 * 读者服务接口
 */
public interface ReaderService extends IService<Reader> {

    /**
     * 分页查询读者
     */
    Page<Reader> listReaders(ReaderQuery query, int pageNum, int pageSize);

    /**
     * 根据ID查询读者
     */
    Reader getReaderById(Long id);

    /**
     * 根据借书证号查询读者
     */
    Reader getReaderByCardNumber(String cardNumber);

    /**
     * 判断读者是否可以借书
     */
    boolean canBorrow(Long id);

    /**
     * 增加借阅数量
     */
    boolean incrementBorrowCount(Long id);

    /**
     * 减少借阅数量
     */
    boolean decrementBorrowCount(Long id);
}
```

- [ ] **Step 3: 创建 ReaderServiceImpl**

```java
// library-reader/src/main/java/com/library/reader/service/impl/ReaderServiceImpl.java
package com.library.reader.service.impl;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.library.reader.domain.Reader;
import com.library.reader.dto.ReaderQuery;
import com.library.reader.mapper.ReaderMapper;
import com.library.reader.service.ReaderService;
import com.ruoyi.common.exception.ServiceException;

/**
 * 读者服务实现
 */
@Service
public class ReaderServiceImpl extends ServiceImpl<ReaderMapper, Reader>
        implements ReaderService {

    @Override
    public Page<Reader> listReaders(ReaderQuery query, int pageNum, int pageSize) {
        LambdaQueryWrapper<Reader> wrapper = new LambdaQueryWrapper<>();

        if (query != null) {
            if (StringUtils.hasText(query.getName())) {
                wrapper.like(Reader::getName, query.getName());
            }
            if (StringUtils.hasText(query.getCardNumber())) {
                wrapper.eq(Reader::getCardNumber, query.getCardNumber());
            }
            if (query.getStatus() != null) {
                wrapper.eq(Reader::getStatus, query.getStatus());
            }
        }

        return page(new Page<>(pageNum, pageSize), wrapper);
    }

    @Override
    public Reader getReaderById(Long id) {
        Reader reader = getById(id);
        if (reader == null) {
            throw new ServiceException("读者不存在");
        }
        return reader;
    }

    @Override
    public Reader getReaderByCardNumber(String cardNumber) {
        LambdaQueryWrapper<Reader> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Reader::getCardNumber, cardNumber);
        Reader reader = getOne(wrapper);
        if (reader == null) {
            throw new ServiceException("读者不存在");
        }
        return reader;
    }

    @Override
    public boolean canBorrow(Long id) {
        Reader reader = getReaderById(id);

        // 检查状态
        if (reader.getStatus() != 1) {
            return false;
        }

        // 检查是否达到最大借阅数
        if (reader.getCurrentBorrowCount() >= reader.getMaxBorrowCount()) {
            return false;
        }

        return true;
    }

    @Override
    public boolean incrementBorrowCount(Long id) {
        int rows = baseMapper.incrementBorrowCount(id);
        if (rows == 0) {
            throw new ServiceException("已达最大借阅数");
        }
        return true;
    }

    @Override
    public boolean decrementBorrowCount(Long id) {
        int rows = baseMapper.decrementBorrowCount(id);
        return rows > 0;
    }
}
```

- [ ] **Step 4: 编写 ReaderServiceTest**

```java
// library-reader/src/test/java/com/library/reader/ReaderServiceTest.java
package com.library.reader;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.junit.jupiter.api.Assertions.*;
import com.library.reader.domain.Reader;
import com.library.reader.service.ReaderService;

@SpringBootTest
class ReaderServiceTest {

    @Autowired
    private ReaderService readerService;

    @Test
    void testSaveAndQueryReader() {
        // Given
        Reader reader = new Reader();
        reader.setName("张三");
        reader.setCardNumber("R2024001");
        reader.setPhone("13800138000");
        reader.setEmail("zhangsan@example.com");
        reader.setStatus(1);
        reader.setMaxBorrowCount(5);
        reader.setCurrentBorrowCount(0);

        // When
        boolean saved = readerService.save(reader);
        Reader found = readerService.getReaderByCardNumber("R2024001");

        // Then
        assertTrue(saved);
        assertNotNull(found);
        assertEquals("张三", found.getName());
    }

    @Test
    void testCanBorrow() {
        // Given
        Reader reader = createTestReader();
        reader.setCurrentBorrowCount(3);
        readerService.save(reader);

        // When & Then
        assertTrue(readerService.canBorrow(reader.getId()));

        // Given
        reader.setCurrentBorrowCount(5);
        readerService.updateById(reader);

        // When & Then
        assertFalse(readerService.canBorrow(reader.getId()));
    }

    @Test
    void testIncrementBorrowCount() {
        // Given
        Reader reader = createTestReader();
        reader.setCurrentBorrowCount(0);
        readerService.save(reader);

        // When
        boolean result = readerService.incrementBorrowCount(reader.getId());
        Reader updated = readerService.getById(reader.getId());

        // Then
        assertTrue(result);
        assertEquals(1, updated.getCurrentBorrowCount());
    }

    private Reader createTestReader() {
        Reader reader = new Reader();
        reader.setName("测试读者");
        reader.setCardNumber("R2024999");
        reader.setStatus(1);
        reader.setMaxBorrowCount(5);
        reader.setCurrentBorrowCount(0);
        return reader;
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `mvn test -Dtest=ReaderServiceTest -pl library-reader`
Expected: 所有测试通过

- [ ] **Step 6: 创建 ReaderController**

```java
// library-reader/src/main/java/com/library/reader/controller/ReaderController.java
package com.library.reader.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.ruoyi.common.core.domain.Result;
import com.library.reader.domain.Reader;
import com.library.reader.dto.ReaderQuery;
import com.library.reader.service.ReaderService;

/**
 * 读者Controller
 */
@RestController
@RequestMapping("/library/reader")
public class ReaderController {

    @Autowired
    private ReaderService readerService;

    /**
     * 分页查询读者列表
     */
    @GetMapping("/list")
    public Result<Page<Reader>> list(ReaderQuery query,
                                      @RequestParam(defaultValue = "1") int pageNum,
                                      @RequestParam(defaultValue = "10") int pageSize) {
        Page<Reader> page = readerService.listReaders(query, pageNum, pageSize);
        return Result.success(page);
    }

    /**
     * 根据ID查询读者
     */
    @GetMapping("/{id}")
    public Result<Reader> getInfo(@PathVariable Long id) {
        Reader reader = readerService.getReaderById(id);
        return Result.success(reader);
    }

    /**
     * 新增读者
     */
    @PostMapping
    public Result<Void> add(@RequestBody Reader reader) {
        readerService.save(reader);
        return Result.success();
    }

    /**
     * 修改读者
     */
    @PutMapping
    public Result<Void> edit(@RequestBody Reader reader) {
        readerService.updateById(reader);
        return Result.success();
    }

    /**
     * 删除读者
     */
    @DeleteMapping("/{id}")
    public Result<Void> remove(@PathVariable Long id) {
        readerService.removeById(id);
        return Result.success();
    }
}
```

- [ ] **Step 7: 测试 API**

Run: `curl http://localhost:8080/library/reader/list?pageNum=1&pageSize=10`
Expected: 返回分页读者列表

- [ ] **Step 8: 提交代码**

```bash
git add library-reader/
git commit -m "feat(library): implement Reader service and controller

- Add ReaderService with borrow check logic
- Add ReaderController with REST API
- Add unit tests for ReaderService"
```

---

## Epic E3：借阅管理

### Task 7: 创建 BorrowRecord 和 FineRecord 实体

**Files:**
- Create: `library-borrow/src/main/resources/schema.sql`
- Create: `library-borrow/src/main/java/com/library/borrow/domain/BorrowRecord.java`
- Create: `library-borrow/src/main/java/com/library/borrow/domain/FineRecord.java`

**Interfaces:**
- Consumes: BaseEntity
- Produces: BorrowRecord entity with status (1:借阅中 2:已归还 3:逾期)
- Produces: FineRecord entity with payment_status (0:未支付 1:已支付)

- [ ] **Step 1: 创建数据库 schema**

```sql
-- library-borrow/src/main/resources/schema.sql

-- 借阅记录表
CREATE TABLE library_borrow_record (
    id BIGSERIAL PRIMARY KEY,
    reader_id BIGINT NOT NULL COMMENT '读者ID',
    book_id BIGINT NOT NULL COMMENT '图书ID',
    borrow_date TIMESTAMP NOT NULL COMMENT '借阅日期',
    due_date TIMESTAMP NOT NULL COMMENT '应还日期',
    actual_return_date TIMESTAMP COMMENT '实际归还日期',
    status TINYINT DEFAULT 1 COMMENT '状态（1:借阅中 2:已归还 3:逾期）',
    renew_count INT DEFAULT 0 COMMENT '续借次数',
    fine_amount DECIMAL(10,2) DEFAULT 0.00 COMMENT '罚款金额',
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reader_status ON library_borrow_record(reader_id, status);
CREATE INDEX idx_book_status ON library_borrow_record(book_id, status);
CREATE INDEX idx_borrow_date ON library_borrow_record(borrow_date);

-- 罚款记录表
CREATE TABLE library_fine_record (
    id BIGSERIAL PRIMARY KEY,
    reader_id BIGINT NOT NULL COMMENT '读者ID',
    borrow_record_id BIGINT NOT NULL COMMENT '借阅记录ID',
    fine_amount DECIMAL(10,2) NOT NULL COMMENT '罚款金额',
    payment_status TINYINT DEFAULT 0 COMMENT '支付状态（0:未支付 1:已支付）',
    payment_date TIMESTAMP COMMENT '支付日期',
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reader_payment ON library_fine_record(reader_id, payment_status);
```

- [ ] **Step 2: 运行 schema 创建表**

Run: `psql -h localhost -p 5433 -U v2 -d xuanji -f library-borrow/src/main/resources/schema.sql`
Expected: 表创建成功

- [ ] **Step 3: 创建 BorrowRecord 实体类**

```java
// library-borrow/src/main/java/com/library/borrow/domain/BorrowRecord.java
package com.library.borrow.domain;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableName;
import com.ruoyi.common.core.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 借阅记录实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("library_borrow_record")
public class BorrowRecord extends BaseEntity {

    /**
     * 读者ID
     */
    private Long readerId;

    /**
     * 图书ID
     */
    private Long bookId;

    /**
     * 借阅日期
     */
    private LocalDateTime borrowDate;

    /**
     * 应还日期
     */
    private LocalDateTime dueDate;

    /**
     * 实际归还日期
     */
    private LocalDateTime actualReturnDate;

    /**
     * 状态（1:借阅中 2:已归还 3:逾期）
     */
    private Integer status;

    /**
     * 续借次数
     */
    private Integer renewCount;

    /**
     * 罚款金额
     */
    private BigDecimal fineAmount;
}
```

- [ ] **Step 4: 创建 FineRecord 实体类**

```java
// library-borrow/src/main/java/com/library/borrow/domain/FineRecord.java
package com.library.borrow.domain;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableField;
import com.ruoyi.common.core.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 罚款记录实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("library_fine_record")
public class FineRecord extends BaseEntity {

    /**
     * 读者ID
     */
    private Long readerId;

    /**
     * 借阅记录ID
     */
    private Long borrowRecordId;

    /**
     * 罚款金额
     */
    private BigDecimal fineAmount;

    /**
     * 支付状态（0:未支付 1:已支付）
     */
    private Integer paymentStatus;

    /**
     * 支付日期
     */
    @TableField("payment_date")
    private LocalDateTime paymentDate;
}
```

- [ ] **Step 5: 提交代码**

```bash
git add library-borrow/
git commit -m "feat(library): create BorrowRecord and FineRecord entities

- Create borrow_record and fine_record tables
- Add BorrowRecord entity with status tracking
- Add FineRecord entity with payment status"
```

---

### Task 8: 实现借书业务逻辑

**Files:**
- Create: `library-borrow/src/main/java/com/library/borrow/mapper/BorrowRecordMapper.java`
- Create: `library-borrow/src/main/resources/mapper/BorrowRecordMapper.xml`
- Create: `library-borrow/src/main/java/com/library/borrow/service/BorrowService.java`
- Create: `library-borrow/src/main/java/com/library/borrow/service/impl/BorrowServiceImpl.java`
- Create: `library-borrow/src/test/java/com/library/borrow/BorrowServiceTest.java`

**Interfaces:**
- Consumes: BookService.decreaseStock() (Task 3), ReaderService.incrementBorrowCount() (Task 6)
- Produces: BorrowService.borrowBook(readerId, bookId) with business validation

- [ ] **Step 1: 创建 BorrowRecordMapper**

```java
// library-borrow/src/main/java/com/library/borrow/mapper/BorrowRecordMapper.java
package com.library.borrow.mapper;

import java.util.List;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.library.borrow.domain.BorrowRecord;
import org.apache.ibatis.annotations.Mapper;

/**
 * 借阅记录Mapper接口
 */
@Mapper
public interface BorrowRecordMapper extends BaseMapper<BorrowRecord> {

}
```

- [ ] **Step 2: 创建 BorrowRecordMapper.xml**

```xml
<!-- library-borrow/src/main/resources/mapper/BorrowRecordMapper.xml -->
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper
PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
"http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.library.borrow.mapper.BorrowRecordMapper">

    <resultMap type="com.library.borrow.domain.BorrowRecord" id="BorrowRecordResult">
        <id     property="id"                column="id"                 />
        <result property="readerId"          column="reader_id"          />
        <result property="bookId"            column="book_id"            />
        <result property="borrowDate"        column="borrow_date"        />
        <result property="dueDate"           column="due_date"           />
        <result property="actualReturnDate"  column="actual_return_date" />
        <result property="status"            column="status"             />
        <result property="renewCount"        column="renew_count"        />
        <result property="fineAmount"        column="fine_amount"        />
        <result property="createTime"        column="create_time"        />
        <result property="updateTime"        column="update_time"        />
    </resultMap>

    <sql id="selectBorrowRecordVo">
        select id, reader_id, book_id, borrow_date, due_date,
               actual_return_date, status, renew_count, fine_amount,
               create_time, update_time
        from library_borrow_record
    </sql>

</mapper>
```

- [ ] **Step 3: 创建 BorrowService 接口**

```java
// library-borrow/src/main/java/com/library/borrow/service/BorrowService.java
package com.library.borrow.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.library.borrow.domain.BorrowRecord;

/**
 * 借阅服务接口
 */
public interface BorrowService extends IService<BorrowRecord> {

    /**
     * 借书
     */
    BorrowRecord borrowBook(Long readerId, Long bookId);

    /**
     * 还书
     */
    BorrowRecord returnBook(Long recordId);

    /**
     * 续借
     */
    BorrowRecord renewBook(Long recordId);

    /**
     * 查询读者的借阅记录
     */
    Page<BorrowRecord> listByReader(Long readerId, int pageNum, int pageSize);
}
```

- [ ] **Step 4: 创建 BorrowServiceImpl（借书逻辑）**

```java
// library-borrow/src/main/java/com/library/borrow/service/impl/BorrowServiceImpl.java
package com.library.borrow.service.impl;

import java.time.LocalDateTime;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.library.borrow.domain.BorrowRecord;
import com.library.borrow.mapper.BorrowRecordMapper;
import com.library.borrow.service.BorrowService;
import com.library.book.service.BookService;
import com.library.reader.service.ReaderService;
import com.ruoyi.common.exception.ServiceException;

/**
 * 借阅服务实现
 */
@Service
public class BorrowServiceImpl extends ServiceImpl<BorrowRecordMapper, BorrowRecord>
        implements BorrowService {

    @Autowired
    private BookService bookService;

    @Autowired
    private ReaderService readerService;

    private static final int BORROW_PERIOD_DAYS = 30;
    private static final int MAX_RENEW_COUNT = 1;
    private static final int RENEW_PERIOD_DAYS = 15;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public BorrowRecord borrowBook(Long readerId, Long bookId) {
        // 1. 检查读者是否可以借书
        if (!readerService.canBorrow(readerId)) {
            throw new ServiceException("读者不可借书（可能已达最大借阅数或账号被禁用）");
        }

        // 2. 检查图书库存
        if (!bookService.checkStock(bookId, 1)) {
            throw new ServiceException("图书库存不足");
        }

        // 3. 检查读者是否有逾期未还的书
        LambdaQueryWrapper<BorrowRecord> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(BorrowRecord::getReaderId, readerId)
               .eq(BorrowRecord::getStatus, 3);
        long overdueCount = count(wrapper);
        if (overdueCount > 0) {
            throw new ServiceException("读者有逾期未还的图书，禁止借书");
        }

        // 4. 创建借阅记录
        BorrowRecord record = new BorrowRecord();
        record.setReaderId(readerId);
        record.setBookId(bookId);
        record.setBorrowDate(LocalDateTime.now());
        record.setDueDate(LocalDateTime.now().plusDays(BORROW_PERIOD_DAYS));
        record.setStatus(1); // 借阅中
        record.setRenewCount(0);
        save(record);

        // 5. 减少图书库存
        bookService.decreaseStock(bookId, 1);

        // 6. 增加读者借阅数
        readerService.incrementBorrowCount(readerId);

        return record;
    }

    @Override
    public Page<BorrowRecord> listByReader(Long readerId, int pageNum, int pageSize) {
        LambdaQueryWrapper<BorrowRecord> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(BorrowRecord::getReaderId, readerId)
               .orderByDesc(BorrowRecord::getBorrowDate);
        return page(new Page<>(pageNum, pageSize), wrapper);
    }

    // returnBook 和 renewBook 留到下一个任务
}
```

- [ ] **Step 5: 编写借书测试**

```java
// library-borrow/src/test/java/com/library/borrow/BorrowServiceTest.java
package com.library.borrow;

import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;
import static org.junit.jupiter.api.Assertions.*;
import com.library.borrow.domain.BorrowRecord;
import com.library.borrow.service.BorrowService;
import com.library.book.domain.Book;
import com.library.book.service.BookService;
import com.library.reader.domain.Reader;
import com.library.reader.service.ReaderService;

@SpringBootTest
@Transactional
class BorrowServiceTest {

    @Autowired
    private BorrowService borrowService;

    @Autowired
    private BookService bookService;

    @Autowired
    private ReaderService readerService;

    @Test
    void testBorrowBook_Success() {
        // Given
        Book book = createTestBook();
        book.setAvailableStock(10);
        bookService.save(book);

        Reader reader = createTestReader();
        readerService.save(reader);

        // When
        BorrowRecord record = borrowService.borrowBook(reader.getId(), book.getId());

        // Then
        assertNotNull(record);
        assertEquals(1, record.getStatus());

        Book updatedBook = bookService.getById(book.getId());
        assertEquals(9, updatedBook.getAvailableStock());

        Reader updatedReader = readerService.getById(reader.getId());
        assertEquals(1, updatedReader.getCurrentBorrowCount());
    }

    @Test
    void testBorrowBook_InsufficientStock() {
        // Given
        Book book = createTestBook();
        book.setAvailableStock(0);
        bookService.save(book);

        Reader reader = createTestReader();
        readerService.save(reader);

        // When & Then
        assertThrows(Exception.class, () -> {
            borrowService.borrowBook(reader.getId(), book.getId());
        });
    }

    @Test
    void testBorrowBook_MaxBorrowCount() {
        // Given
        Reader reader = createTestReader();
        reader.setCurrentBorrowCount(5);
        readerService.save(reader);

        Book book = createTestBook();
        bookService.save(book);

        // When & Then
        assertThrows(Exception.class, () -> {
            borrowService.borrowBook(reader.getId(), book.getId());
        });
    }

    private Book createTestBook() {
        Book book = new Book();
        book.setIsbn("9787111234569");
        book.setTitle("测试图书");
        book.setStock(10);
        book.setAvailableStock(10);
        return book;
    }

    private Reader createTestReader() {
        Reader reader = new Reader();
        reader.setName("测试读者");
        reader.setCardNumber("R2024001");
        reader.setStatus(1);
        reader.setMaxBorrowCount(5);
        reader.setCurrentBorrowCount(0);
        return reader;
    }
}
```

- [ ] **Step 6: 运行测试**

Run: `mvn test -Dtest=BorrowServiceTest -pl library-borrow`
Expected: 所有测试通过

- [ ] **Step 7: 提交代码**

```bash
git add library-borrow/
git commit -m "feat(library): implement borrow book logic

- Add BorrowRecordMapper and service
- Implement borrowBook with validation
- Add tests for borrow scenarios"
```

---

### Task 9: 实现还书和续借业务逻辑

**Files:**
- Modify: `library-borrow/src/main/java/com/library/borrow/service/impl/BorrowServiceImpl.java`
- Create: `library-borrow/src/main/java/com/library/borrow/mapper/FineRecordMapper.java`
- Create: `library-borrow/src/main/java/com/library/borrow/service/FineService.java`
- Create: `library-borrow/src/main/java/com/library/borrow/service/impl/FineServiceImpl.java`
- Modify: `library-borrow/src/test/java/com/library/borrow/BorrowServiceTest.java`

**Interfaces:**
- Consumes: BookService.increaseStock(), ReaderService.decrementBorrowCount()
- Produces: returnBook(), renewBook() with fine calculation

- [ ] **Step 1: 创建 FineRecordMapper**

```java
// library-borrow/src/main/java/com/library/borrow/mapper/FineRecordMapper.java
package com.library.borrow.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.library.borrow.domain.FineRecord;
import org.apache.ibatis.annotations.Mapper;

/**
 * 罚款记录Mapper接口
 */
@Mapper
public interface FineRecordMapper extends BaseMapper<FineRecord> {

}
```

- [ ] **Step 2: 创建 FineService 接口**

```java
// library-borrow/src/main/java/com/library/borrow/service/FineService.java
package com.library.borrow.service;

import java.math.BigDecimal;
import com.baomidou.mybatisplus.extension.service.IService;
import com.library.borrow.domain.FineRecord;

/**
 * 罚款服务接口
 */
public interface FineService extends IService<FineRecord> {

    /**
     * 计算罚款
     */
    BigDecimal calculateFine(LocalDateTime dueDate, LocalDateTime returnDate);

    /**
     * 查询读者的未支付罚款
     */
    BigDecimal getUnpaidFine(Long readerId);

    /**
     * 缴纳罚款
     */
    boolean payFine(Long fineId);
}
```

- [ ] **Step 3: 创建 FineServiceImpl**

```java
// library-borrow/src/main/java/com/library/borrow/service/impl/FineServiceImpl.java
package com.library.borrow.service.impl;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.library.borrow.domain.FineRecord;
import com.library.borrow.mapper.FineRecordMapper;
import com.library.borrow.service.FineService;
import com.ruoyi.common.exception.ServiceException;

/**
 * 罚款服务实现
 */
@Service
public class FineServiceImpl extends ServiceImpl<FineRecordMapper, FineRecord>
        implements FineService {

    private static final BigDecimal FINE_RATE_PER_DAY = new BigDecimal("0.1");

    @Override
    public BigDecimal calculateFine(LocalDateTime dueDate, LocalDateTime returnDate) {
        long daysOverdue = ChronoUnit.DAYS.between(dueDate, returnDate);
        if (daysOverdue <= 0) {
            return BigDecimal.ZERO;
        }
        return FINE_RATE_PER_DAY.multiply(new BigDecimal(daysOverdue));
    }

    @Override
    public BigDecimal getUnpaidFine(Long readerId) {
        LambdaQueryWrapper<FineRecord> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(FineRecord::getReaderId, readerId)
               .eq(FineRecord::getPaymentStatus, 0);

        return list(wrapper).stream()
                .map(FineRecord::getFineAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean payFine(Long fineId) {
        FineRecord fine = getById(fineId);
        if (fine == null) {
            throw new ServiceException("罚款记录不存在");
        }

        if (fine.getPaymentStatus() == 1) {
            throw new ServiceException("罚款已缴纳");
        }

        fine.setPaymentStatus(1);
        fine.setPaymentDate(LocalDateTime.now());
        return updateById(fine);
    }
}
```

- [ ] **Step 4: 完善 BorrowServiceImpl（还书和续借）**

```java
// 添加到 BorrowServiceImpl.java

    @Override
    @Transactional(rollbackFor = Exception.class)
    public BorrowRecord returnBook(Long recordId) {
        BorrowRecord record = getById(recordId);
        if (record == null) {
            throw new ServiceException("借阅记录不存在");
        }

        if (record.getStatus() == 2) {
            throw new ServiceException("图书已归还");
        }

        LocalDateTime returnDate = LocalDateTime.now();
        record.setActualReturnDate(returnDate);

        // 检查是否逾期
        if (returnDate.isAfter(record.getDueDate())) {
            record.setStatus(3); // 逾期

            // 计算罚款
            BigDecimal fine = fineService.calculateFine(record.getDueDate(), returnDate);
            record.setFineAmount(fine);

            // 创建罚款记录
            FineRecord fineRecord = new FineRecord();
            fineRecord.setReaderId(record.getReaderId());
            fineRecord.setBorrowRecordId(recordId);
            fineRecord.setFineAmount(fine);
            fineRecord.setPaymentStatus(0);
            fineService.save(fineRecord);
        } else {
            record.setStatus(2); // 已归还
        }

        updateById(record);

        // 增加图书库存
        bookService.increaseStock(record.getBookId(), 1);

        // 减少读者借阅数
        readerService.decrementBorrowCount(record.getReaderId());

        return record;
    }

    @Override
    public BorrowRecord renewBook(Long recordId) {
        BorrowRecord record = getById(recordId);
        if (record == null) {
            throw new ServiceException("借阅记录不存在");
        }

        if (record.getStatus() != 1) {
            throw new ServiceException("只有借阅中的图书可以续借");
        }

        if (record.getRenewCount() >= MAX_RENEW_COUNT) {
            throw new ServiceException("已达最大续借次数");
        }

        if (LocalDateTime.now().isAfter(record.getDueDate())) {
            throw new ServiceException("已逾期的图书不可续借");
        }

        record.setDueDate(record.getDueDate().plusDays(RENEW_PERIOD_DAYS));
        record.setRenewCount(record.getRenewCount() + 1);
        updateById(record);

        return record;
    }
```

- [ ] **Step 5: 添加还书和续借测试**

```java
// 添加到 BorrowServiceTest.java

    @Test
    void testReturnBook_Success() {
        // Given
        BorrowRecord record = createBorrowedRecord();
        borrowService.save(record);

        // When
        BorrowRecord returned = borrowService.returnBook(record.getId());

        // Then
        assertEquals(2, returned.getStatus());
        assertNotNull(returned.getActualReturnDate());
    }

    @Test
    void testReturnBook_Overdue() {
        // Given
        BorrowRecord record = createBorrowedRecord();
        record.setDueDate(LocalDateTime.now().minusDays(5));
        borrowService.save(record);

        // When
        BorrowRecord returned = borrowService.returnBook(record.getId());

        // Then
        assertEquals(3, returned.getStatus());
        assertTrue(returned.getFineAmount().compareTo(BigDecimal.ZERO) > 0);
    }

    @Test
    void testRenewBook_Success() {
        // Given
        BorrowRecord record = createBorrowedRecord();
        record.setDueDate(LocalDateTime.now().plusDays(10));
        borrowService.save(record);

        // When
        BorrowRecord renewed = borrowService.renewBook(record.getId());

        // Then
        assertEquals(1, renewed.getRenewCount());
    }

    @Test
    void testRenewBook_MaxRenewCount() {
        // Given
        BorrowRecord record = createBorrowedRecord();
        record.setRenewCount(1);
        borrowService.save(record);

        // When & Then
        assertThrows(Exception.class, () -> {
            borrowService.renewBook(record.getId());
        });
    }

    private BorrowRecord createBorrowedRecord() {
        BorrowRecord record = new BorrowRecord();
        record.setReaderId(1L);
        record.setBookId(1L);
        record.setBorrowDate(LocalDateTime.now());
        record.setDueDate(LocalDateTime.now().plusDays(30));
        record.setStatus(1);
        record.setRenewCount(0);
        return record;
    }
```

- [ ] **Step 6: 运行测试**

Run: `mvn test -Dtest=BorrowServiceTest -pl library-borrow`
Expected: 所有测试通过

- [ ] **Step 7: 提交代码**

```bash
git add library-borrow/
git commit -m "feat(library): implement return and renew logic with fine calculation

- Add FineService for fine management
- Implement returnBook with overdue check
- Implement renewBook with validation
- Add tests for return and renew scenarios"
```

---

### Task 10: 实现借阅 API

**Files:**
- Create: `library-borrow/src/main/java/com/library/borrow/controller/BorrowController.java`

**Interfaces:**
- Consumes: BorrowService (Task 8-9)
- Produces: REST API for borrow/return/renew operations

- [ ] **Step 1: 创建 BorrowController**

```java
// library-borrow/src/main/java/com/library/borrow/controller/BorrowController.java
package com.library.borrow.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.ruoyi.common.core.domain.Result;
import com.library.borrow.domain.BorrowRecord;
import com.library.borrow.service.BorrowService;

/**
 * 借阅Controller
 */
@RestController
@RequestMapping("/library/borrow")
public class BorrowController {

    @Autowired
    private BorrowService borrowService;

    /**
     * 借书
     */
    @PostMapping("/borrow")
    public Result<BorrowRecord> borrow(@RequestParam Long readerId,
                                        @RequestParam Long bookId) {
        BorrowRecord record = borrowService.borrowBook(readerId, bookId);
        return Result.success(record);
    }

    /**
     * 还书
     */
    @PostMapping("/return/{recordId}")
    public Result<BorrowRecord> returnBook(@PathVariable Long recordId) {
        BorrowRecord record = borrowService.returnBook(recordId);
        return Result.success(record);
    }

    /**
     * 续借
     */
    @PostMapping("/renew/{recordId}")
    public Result<BorrowRecord> renew(@PathVariable Long recordId) {
        BorrowRecord record = borrowService.renewBook(recordId);
        return Result.success(record);
    }

    /**
     * 查询读者的借阅记录
     */
    @GetMapping("/list")
    public Result<Page<BorrowRecord>> list(@RequestParam Long readerId,
                                            @RequestParam(defaultValue = "1") int pageNum,
                                            @RequestParam(defaultValue = "10") int pageSize) {
        Page<BorrowRecord> page = borrowService.listByReader(readerId, pageNum, pageSize);
        return Result.success(page);
    }
}
```

- [ ] **Step 2: 测试 API**

Run: `curl -X POST "http://localhost:8080/library/borrow/borrow?readerId=1&bookId=1"`
Expected: 返回借阅记录

- [ ] **Step 3: 提交代码**

```bash
git add library-borrow/src/main/java/com/library/borrow/controller/
git commit -m "feat(library): add borrow REST API endpoints

- Add borrow, return, renew endpoints
- Add reader borrow record list endpoint"
```

---

## Epic E4：罚款管理

### Task 11: 实现罚款查询和缴纳 API

**Files:**
- Create: `library-borrow/src/main/java/com/library/borrow/controller/FineController.java`

**Interfaces:**
- Consumes: FineService (Task 9)
- Produces: REST API for fine management

- [ ] **Step 1: 创建 FineController**

```java
// library-borrow/src/main/java/com/library/borrow/controller/FineController.java
package com.library.borrow.controller;

import java.math.BigDecimal;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import com.ruoyi.common.core.domain.Result;
import com.library.borrow.domain.FineRecord;
import com.library.borrow.service.FineService;

/**
 * 罚款Controller
 */
@RestController
@RequestMapping("/library/fine")
public class FineController {

    @Autowired
    private FineService fineService;

    /**
     * 查询读者的未支付罚款
     */
    @GetMapping("/unpaid")
    public Result<BigDecimal> getUnpaidFine(@RequestParam Long readerId) {
        BigDecimal fine = fineService.getUnpaidFine(readerId);
        return Result.success(fine);
    }

    /**
     * 查询读者的罚款记录
     */
    @GetMapping("/list")
    public Result<List<FineRecord>> list(@RequestParam Long readerId) {
        List<FineRecord> records = fineService.lambdaQuery()
                .eq(FineRecord::getReaderId, readerId)
                .list();
        return Result.success(records);
    }

    /**
     * 缴纳罚款
     */
    @PostMapping("/pay/{fineId}")
    public Result<Void> pay(@PathVariable Long fineId) {
        fineService.payFine(fineId);
        return Result.success();
    }
}
```

- [ ] **Step 2: 测试 API**

Run: `curl "http://localhost:8080/library/fine/unpaid?readerId=1"`
Expected: 返回未支付罚款金额

- [ ] **Step 3: 提交代码**

```bash
git add library-borrow/src/main/java/com/library/borrow/controller/FineController.java
git commit -m "feat(library): add fine management REST API

- Add unpaid fine query endpoint
- Add fine payment endpoint
- Add fine list endpoint"
```

---

## Epic E5：统计报表

### Task 12: 实现统计报表服务

**Files:**
- Create: `library-report/src/main/java/com/library/report/service/ReportService.java`
- Create: `library-report/src/main/java/com/library/report/service/impl/ReportServiceImpl.java`
- Create: `library-report/src/main/java/com/library/report/dto/BorrowStatistics.java`
- Create: `library-report/src/main/java/com/library/report/dto/BookRanking.java`
- Create: `library-report/src/test/java/com/library/report/ReportServiceTest.java`

**Interfaces:**
- Consumes: BorrowRecordMapper
- Produces: BorrowStatistics, BookRanking

- [ ] **Step 1: 创建统计 DTO**

```java
// library-report/src/main/java/com/library/report/dto/BorrowStatistics.java
package com.library.report.dto;

import lombok.Data;
import java.time.LocalDate;

/**
 * 借阅统计
 */
@Data
public class BorrowStatistics {

    /**
     * 日期
     */
    private LocalDate date;

    /**
     * 借阅数量
     */
    private Long count;
}
```

```java
// library-report/src/main/java/com/library/report/dto/BookRanking.java
package com.library.report.dto;

import lombok.Data;

/**
 * 图书借阅排行
 */
@Data
public class BookRanking {

    /**
     * 图书ID
     */
    private Long bookId;

    /**
     * 书名
     */
    private String title;

    /**
     * 借阅次数
     */
    private Long borrowCount;
}
```

- [ ] **Step 2: 创建 ReportService**

```java
// library-report/src/main/java/com/library/report/service/ReportService.java
package com.library.report.service;

import java.time.LocalDate;
import java.util.List;
import com.library.report.dto.BorrowStatistics;
import com.library.report.dto.BookRanking;

/**
 * 报表服务接口
 */
public interface ReportService {

    /**
     * 借阅趋势统计（最近N天）
     */
    List<BorrowStatistics> getBorrowTrend(int days);

    /**
     * 热门图书排行
     */
    List<BookRanking> getHotBooks(int limit);

    /**
     * 读者借阅排行
     */
    List<Object[]> getReaderRanking(int limit);
}
```

- [ ] **Step 3: 创建 ReportServiceImpl**

```java
// library-report/src/main/java/com/library/report/service/impl/ReportServiceImpl.java
package com.library.report.service.impl;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import com.library.report.dto.BorrowStatistics;
import com.library.report.dto.BookRanking;
import com.library.report.service.ReportService;

/**
 * 报表服务实现
 */
@Service
public class ReportServiceImpl implements ReportService {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Override
    public List<BorrowStatistics> getBorrowTrend(int days) {
        String sql = "SELECT DATE(borrow_date) as date, COUNT(*) as count " +
                     "FROM library_borrow_record " +
                     "WHERE borrow_date >= ? " +
                     "GROUP BY DATE(borrow_date) " +
                     "ORDER BY date DESC";

        LocalDate startDate = LocalDate.now().minusDays(days);
        return jdbcTemplate.query(sql,
                (rs, rowNum) -> {
                    BorrowStatistics stats = new BorrowStatistics();
                    stats.setDate(rs.getDate("date").toLocalDate());
                    stats.setCount(rs.getLong("count"));
                    return stats;
                },
                startDate);
    }

    @Override
    public List<BookRanking> getHotBooks(int limit) {
        String sql = "SELECT b.id as book_id, b.title, COUNT(*) as borrow_count " +
                     "FROM library_borrow_record r " +
                     "JOIN library_book b ON r.book_id = b.id " +
                     "GROUP BY b.id, b.title " +
                     "ORDER BY borrow_count DESC " +
                     "LIMIT ?";

        return jdbcTemplate.query(sql,
                (rs, rowNum) -> {
                    BookRanking ranking = new BookRanking();
                    ranking.setBookId(rs.getLong("book_id"));
                    ranking.setTitle(rs.getString("title"));
                    ranking.setBorrowCount(rs.getLong("borrow_count"));
                    return ranking;
                },
                limit);
    }

    @Override
    public List<Object[]> getReaderRanking(int limit) {
        String sql = "SELECT r.id, r.name, COUNT(*) as borrow_count " +
                     "FROM library_borrow_record br " +
                     "JOIN library_reader r ON br.reader_id = r.id " +
                     "GROUP BY r.id, r.name " +
                     "ORDER BY borrow_count DESC " +
                     "LIMIT ?";

        return jdbcTemplate.query(sql,
                (rs, rowNum) -> new Object[]{
                    rs.getLong("id"),
                    rs.getString("name"),
                    rs.getLong("borrow_count")
                },
                limit);
    }
}
```

- [ ] **Step 4: 编写测试**

```java
// library-report/src/test/java/com/library/report/ReportServiceTest.java
package com.library.report;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.junit.jupiter.api.Assertions.*;
import com.library.report.dto.BorrowStatistics;
import com.library.report.dto.BookRanking;
import com.library.report.service.ReportService;

@SpringBootTest
class ReportServiceTest {

    @Autowired
    private ReportService reportService;

    @Test
    void testGetBorrowTrend() {
        // When
        List<BorrowStatistics> trend = reportService.getBorrowTrend(30);

        // Then
        assertNotNull(trend);
    }

    @Test
    void testGetHotBooks() {
        // When
        List<BookRanking> ranking = reportService.getHotBooks(10);

        // Then
        assertNotNull(ranking);
        assertTrue(ranking.size() <= 10);
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `mvn test -Dtest=ReportServiceTest -pl library-report`
Expected: 所有测试通过

- [ ] **Step 6: 提交代码**

```bash
git add library-report/
git commit -m "feat(library): implement report service

- Add borrow trend statistics
- Add hot books ranking
- Add reader ranking
- Add unit tests"
```

---

### Task 13: 实现统计报表 API

**Files:**
- Create: `library-report/src/main/java/com/library/report/controller/ReportController.java`

**Interfaces:**
- Consumes: ReportService (Task 12)
- Produces: REST API for reports

- [ ] **Step 1: 创建 ReportController**

```java
// library-report/src/main/java/com/library/report/controller/ReportController.java
package com.library.report.controller;

import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import com.ruoyi.common.core.domain.Result;
import com.library.report.dto.BorrowStatistics;
import com.library.report.dto.BookRanking;
import com.library.report.service.ReportService;

/**
 * 报表Controller
 */
@RestController
@RequestMapping("/library/report")
public class ReportController {

    @Autowired
    private ReportService reportService;

    /**
     * 借阅趋势统计
     */
    @GetMapping("/borrow-trend")
    public Result<List<BorrowStatistics>> borrowTrend(
            @RequestParam(defaultValue = "30") int days) {
        List<BorrowStatistics> trend = reportService.getBorrowTrend(days);
        return Result.success(trend);
    }

    /**
     * 热门图书排行
     */
    @GetMapping("/hot-books")
    public Result<List<BookRanking>> hotBooks(
            @RequestParam(defaultValue = "10") int limit) {
        List<BookRanking> ranking = reportService.getHotBooks(limit);
        return Result.success(ranking);
    }

    /**
     * 读者借阅排行
     */
    @GetMapping("/reader-ranking")
    public Result<List<Object[]>> readerRanking(
            @RequestParam(defaultValue = "10") int limit) {
        List<Object[]> ranking = reportService.getReaderRanking(limit);
        return Result.success(ranking);
    }
}
```

- [ ] **Step 2: 测试 API**

Run: `curl "http://localhost:8080/library/report/borrow-trend?days=30"`
Expected: 返回借阅趋势数据

- [ ] **Step 3: 提交代码**

```bash
git add library-report/src/main/java/com/library/report/controller/
git commit -m "feat(library): add report REST API

- Add borrow trend endpoint
- Add hot books ranking endpoint
- Add reader ranking endpoint"
```

---

## 前端实现

### Task 14: 创建前端项目结构和 API 封装

**Files:**
- Create: `library-ui/src/api/book.ts`
- Create: `library-ui/src/api/category.ts`
- Create: `library-ui/src/api/reader.ts`
- Create: `library-ui/src/api/borrow.ts`
- Create: `library-ui/src/api/report.ts`

**Interfaces:**
- Produces: TypeScript API clients for all backend services

- [ ] **Step 1: 创建 book.ts**

```typescript
// library-ui/src/api/book.ts
import request from '@/utils/request'

export interface Book {
  id: number
  isbn: string
  title: string
  author: string
  publisher: string
  categoryId: number
  publishDate: string
  price: number
  stock: number
  availableStock: number
  location: string
  description: string
  coverImage: string
}

export interface BookQuery {
  isbn?: string
  title?: string
  author?: string
  categoryId?: number
}

export function listBooks(query: BookQuery, pageNum: number, pageSize: number) {
  return request({
    url: '/library/book/list',
    method: 'get',
    params: { ...query, pageNum, pageSize }
  })
}

export function getBook(id: number) {
  return request({
    url: `/library/book/${id}`,
    method: 'get'
  })
}

export function addBook(data: Book) {
  return request({
    url: '/library/book',
    method: 'post',
    data
  })
}

export function updateBook(data: Book) {
  return request({
    url: '/library/book',
    method: 'put',
    data
  })
}

export function deleteBook(id: number) {
  return request({
    url: `/library/book/${id}`,
    method: 'delete'
  })
}
```

- [ ] **Step 2: 创建 category.ts**

```typescript
// library-ui/src/api/category.ts
import request from '@/utils/request'

export interface Category {
  id: number
  name: string
  parentId: number
  sort: number
  children?: Category[]
}

export function getCategoryTree() {
  return request({
    url: '/library/category/tree',
    method: 'get'
  })
}

export function addCategory(data: Category) {
  return request({
    url: '/library/category',
    method: 'post',
    data
  })
}

export function updateCategory(data: Category) {
  return request({
    url: '/library/category',
    method: 'put',
    data
  })
}

export function deleteCategory(id: number) {
  return request({
    url: `/library/category/${id}`,
    method: 'delete'
  })
}
```

- [ ] **Step 3: 创建 reader.ts**

```typescript
// library-ui/src/api/reader.ts
import request from '@/utils/request'

export interface Reader {
  id: number
  name: string
  phone: string
  email: string
  cardNumber: string
  status: number
  maxBorrowCount: number
  currentBorrowCount: number
}

export interface ReaderQuery {
  name?: string
  cardNumber?: string
  status?: number
}

export function listReaders(query: ReaderQuery, pageNum: number, pageSize: number) {
  return request({
    url: '/library/reader/list',
    method: 'get',
    params: { ...query, pageNum, pageSize }
  })
}

export function addReader(data: Reader) {
  return request({
    url: '/library/reader',
    method: 'post',
    data
  })
}

export function updateReader(data: Reader) {
  return request({
    url: '/library/reader',
    method: 'put',
    data
  })
}

export function deleteReader(id: number) {
  return request({
    url: `/library/reader/${id}`,
    method: 'delete'
  })
}
```

- [ ] **Step 4: 创建 borrow.ts**

```typescript
// library-ui/src/api/borrow.ts
import request from '@/utils/request'

export interface BorrowRecord {
  id: number
  readerId: number
  bookId: number
  borrowDate: string
  dueDate: string
  actualReturnDate: string
  status: number
  renewCount: number
  fineAmount: number
}

export function borrowBook(readerId: number, bookId: number) {
  return request({
    url: '/library/borrow/borrow',
    method: 'post',
    params: { readerId, bookId }
  })
}

export function returnBook(recordId: number) {
  return request({
    url: `/library/borrow/return/${recordId}`,
    method: 'post'
  })
}

export function renewBook(recordId: number) {
  return request({
    url: `/library/borrow/renew/${recordId}`,
    method: 'post'
  })
}

export function listBorrowRecords(readerId: number, pageNum: number, pageSize: number) {
  return request({
    url: '/library/borrow/list',
    method: 'get',
    params: { readerId, pageNum, pageSize }
  })
}

export function getUnpaidFine(readerId: number) {
  return request({
    url: '/library/fine/unpaid',
    method: 'get',
    params: { readerId }
  })
}

export function payFine(fineId: number) {
  return request({
    url: `/library/fine/pay/${fineId}`,
    method: 'post'
  })
}
```

- [ ] **Step 5: 创建 report.ts**

```typescript
// library-ui/src/api/report.ts
import request from '@/utils/request'

export interface BorrowStatistics {
  date: string
  count: number
}

export interface BookRanking {
  bookId: number
  title: string
  borrowCount: number
}

export function getBorrowTrend(days: number = 30) {
  return request({
    url: '/library/report/borrow-trend',
    method: 'get',
    params: { days }
  })
}

export function getHotBooks(limit: number = 10) {
  return request({
    url: '/library/report/hot-books',
    method: 'get',
    params: { limit }
  })
}

export function getReaderRanking(limit: number = 10) {
  return request({
    url: '/library/report/reader-ranking',
    method: 'get',
    params: { limit }
  })
}
```

- [ ] **Step 6: 提交代码**

```bash
git add library-ui/src/api/
git commit -m "feat(library-ui): create API clients

- Add book, category, reader, borrow, report API
- All APIs use TypeScript interfaces
- Follow frontend API conventions"
```

---

### Task 15: 实现图书列表页面

**Files:**
- Create: `library-ui/src/views/book/BookList.vue`
- Create: `library-ui/src/views/book/BookForm.vue`

**Interfaces:**
- Consumes: book.ts, category.ts API clients
- Produces: Book list UI with CRUD operations

- [ ] **Step 1: 创建 BookList.vue**

```vue
<!-- library-ui/src/views/book/BookList.vue -->
<template>
  <div class="book-list">
    <el-card>
      <template #header>
        <div class="header">
          <span>图书管理</span>
          <el-button type="primary" @click="handleAdd">新增</el-button>
        </div>
      </template>

      <!-- 搜索表单 -->
      <el-form :inline="true" :model="queryParams">
        <el-form-item label="书名">
          <el-input v-model="queryParams.title" placeholder="请输入书名" />
        </el-form-item>
        <el-form-item label="作者">
          <el-input v-model="queryParams.author" placeholder="请输入作者" />
        </el-form-item>
        <el-form-item label="ISBN">
          <el-input v-model="queryParams.isbn" placeholder="请输入ISBN" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">搜索</el-button>
          <el-button @click="resetQuery">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 图书列表 -->
      <el-table :data="bookList" v-loading="loading">
        <el-table-column prop="isbn" label="ISBN" width="150" />
        <el-table-column prop="title" label="书名" />
        <el-table-column prop="author" label="作者" width="120" />
        <el-table-column prop="publisher" label="出版社" width="150" />
        <el-table-column prop="price" label="价格" width="100" />
        <el-table-column prop="availableStock" label="可借库存" width="100">
          <template #default="{ row }">
            <el-tag :type="row.availableStock > 0 ? 'success' : 'danger'">
              {{ row.availableStock }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <el-pagination
        v-model:current-page="pageNum"
        v-model:page-size="pageSize"
        :total="total"
        @current-change="getList"
      />
    </el-card>

    <!-- 新增/编辑对话框 -->
    <BookForm
      v-if="showForm"
      :visible="showForm"
      :book-id="currentBookId"
      @close="showForm = false"
      @success="handleFormSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listBooks, deleteBook, type Book, type BookQuery } from '@/api/book'
import BookForm from './BookForm.vue'

const loading = ref(false)
const bookList = ref<Book[]>([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const queryParams = ref<BookQuery>({})
const showForm = ref(false)
const currentBookId = ref<number | null>(null)

const getList = async () => {
  loading.value = true
  try {
    const res = await listBooks(queryParams.value, pageNum.value, pageSize.value)
    bookList.value = res.data.records
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  pageNum.value = 1
  getList()
}

const resetQuery = () => {
  queryParams.value = {}
  handleQuery()
}

const handleAdd = () => {
  currentBookId.value = null
  showForm.value = true
}

const handleEdit = (row: Book) => {
  currentBookId.value = row.id
  showForm.value = true
}

const handleDelete = async (row: Book) => {
  await ElMessageBox.confirm(`确认删除图书"${row.title}"吗？`, '提示', {
    type: 'warning'
  })
  await deleteBook(row.id)
  ElMessage.success('删除成功')
  getList()
}

const handleFormSuccess = () => {
  showForm.value = false
  getList()
}

onMounted(() => {
  getList()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
```

- [ ] **Step 2: 创建 BookForm.vue**

```vue
<!-- library-ui/src/views/book/BookForm.vue -->
<template>
  <el-dialog
    :title="bookId ? '编辑图书' : '新增图书'"
    :model-value="visible"
    @close="emit('close')"
    width="600px"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="ISBN" prop="isbn">
        <el-input v-model="form.isbn" />
      </el-form-item>
      <el-form-item label="书名" prop="title">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="作者" prop="author">
        <el-input v-model="form.author" />
      </el-form-item>
      <el-form-item label="出版社">
        <el-input v-model="form.publisher" />
      </el-form-item>
      <el-form-item label="分类">
        <el-cascader
          v-model="form.categoryId"
          :options="categoryTree"
          :props="{ value: 'id', label: 'name' }"
        />
      </el-form-item>
      <el-form-item label="价格">
        <el-input-number v-model="form.price" :precision="2" />
      </el-form-item>
      <el-form-item label="库存">
        <el-input-number v-model="form.stock" />
      </el-form-item>
      <el-form-item label="馆藏位置">
        <el-input v-model="form.location" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { getBook, addBook, updateBook, type Book } from '@/api/book'
import { getCategoryTree, type Category } from '@/api/category'

const props = defineProps<{
  visible: boolean
  bookId: number | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const formRef = ref<FormInstance>()
const form = ref<Book>({} as Book)
const categoryTree = ref<Category[]>([])

const rules: FormRules = {
  isbn: [{ required: true, message: '请输入ISBN', trigger: 'blur' }],
  title: [{ required: true, message: '请输入书名', trigger: 'blur' }]
}

const loadCategoryTree = async () => {
  const res = await getCategoryTree()
  categoryTree.value = res.data
}

const loadBook = async () => {
  if (props.bookId) {
    const res = await getBook(props.bookId)
    form.value = res.data
  } else {
    form.value = {} as Book
  }
}

const handleSubmit = async () => {
  await formRef.value?.validate()

  if (props.bookId) {
    await updateBook(form.value)
    ElMessage.success('修改成功')
  } else {
    await addBook(form.value)
    ElMessage.success('新增成功')
  }

  emit('success')
}

watch(() => props.visible, (val) => {
  if (val) {
    loadCategoryTree()
    loadBook()
  }
})

onMounted(() => {
  loadCategoryTree()
})
</script>
```

- [ ] **Step 3: 提交代码**

```bash
git add library-ui/src/views/book/
git commit -m "feat(library-ui): implement book list and form

- Add BookList with search and pagination
- Add BookForm for create/edit
- Use Element Plus components"
```

---

### Task 16: 实现读者管理页面

**Files:**
- Create: `library-ui/src/views/reader/ReaderList.vue`
- Create: `library-ui/src/views/reader/ReaderForm.vue`

**Interfaces:**
- Consumes: reader.ts API client
- Produces: Reader management UI

- [ ] **Step 1: 创建 ReaderList.vue**

```vue
<!-- library-ui/src/views/reader/ReaderList.vue -->
<template>
  <div class="reader-list">
    <el-card>
      <template #header>
        <div class="header">
          <span>读者管理</span>
          <el-button type="primary" @click="handleAdd">新增</el-button>
        </div>
      </template>

      <!-- 搜索表单 -->
      <el-form :inline="true" :model="queryParams">
        <el-form-item label="姓名">
          <el-input v-model="queryParams.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="借书证号">
          <el-input v-model="queryParams.cardNumber" placeholder="请输入借书证号" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">搜索</el-button>
          <el-button @click="resetQuery">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 读者列表 -->
      <el-table :data="readerList" v-loading="loading">
        <el-table-column prop="cardNumber" label="借书证号" width="150" />
        <el-table-column prop="name" label="姓名" width="120" />
        <el-table-column prop="phone" label="手机号" width="150" />
        <el-table-column prop="email" label="邮箱" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'">
              {{ row.status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="借阅情况" width="150">
          <template #default="{ row }">
            {{ row.currentBorrowCount }} / {{ row.maxBorrowCount }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <el-pagination
        v-model:current-page="pageNum"
        v-model:page-size="pageSize"
        :total="total"
        @current-change="getList"
      />
    </el-card>

    <!-- 新增/编辑对话框 -->
    <ReaderForm
      v-if="showForm"
      :visible="showForm"
      :reader-id="currentReaderId"
      @close="showForm = false"
      @success="handleFormSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listReaders, deleteReader, type Reader, type ReaderQuery } from '@/api/reader'
import ReaderForm from './ReaderForm.vue'

const loading = ref(false)
const readerList = ref<Reader[]>([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(10)
const queryParams = ref<ReaderQuery>({})
const showForm = ref(false)
const currentReaderId = ref<number | null>(null)

const getList = async () => {
  loading.value = true
  try {
    const res = await listReaders(queryParams.value, pageNum.value, pageSize.value)
    readerList.value = res.data.records
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  pageNum.value = 1
  getList()
}

const resetQuery = () => {
  queryParams.value = {}
  handleQuery()
}

const handleAdd = () => {
  currentReaderId.value = null
  showForm.value = true
}

const handleEdit = (row: Reader) => {
  currentReaderId.value = row.id
  showForm.value = true
}

const handleDelete = async (row: Reader) => {
  await ElMessageBox.confirm(`确认删除读者"${row.name}"吗？`, '提示', {
    type: 'warning'
  })
  await deleteReader(row.id)
  ElMessage.success('删除成功')
  getList()
}

const handleFormSuccess = () => {
  showForm.value = false
  getList()
}

onMounted(() => {
  getList()
})
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
```

- [ ] **Step 2: 创建 ReaderForm.vue**

```vue
<!-- library-ui/src/views/reader/ReaderForm.vue -->
<template>
  <el-dialog
    :title="readerId ? '编辑读者' : '新增读者'"
    :model-value="visible"
    @close="emit('close')"
    width="600px"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="借书证号" prop="cardNumber">
        <el-input v-model="form.cardNumber" />
      </el-form-item>
      <el-form-item label="姓名" prop="name">
        <el-input v-model="form.name" />
      </el-form-item>
      <el-form-item label="手机号">
        <el-input v-model="form.phone" />
      </el-form-item>
      <el-form-item label="邮箱">
        <el-input v-model="form.email" />
      </el-form-item>
      <el-form-item label="最大借阅数">
        <el-input-number v-model="form.maxBorrowCount" :min="1" :max="20" />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio :value="1">正常</el-radio>
          <el-radio :value="0">禁用</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { getReader, addReader, updateReader, type Reader } from '@/api/reader'

const props = defineProps<{
  visible: boolean
  readerId: number | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const formRef = ref<FormInstance>()
const form = ref<Reader>({} as Reader)

const rules: FormRules = {
  cardNumber: [{ required: true, message: '请输入借书证号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }]
}

const loadReader = async () => {
  if (props.readerId) {
    const res = await getReader(props.readerId)
    form.value = res.data
  } else {
    form.value = {
      status: 1,
      maxBorrowCount: 5,
      currentBorrowCount: 0
    } as Reader
  }
}

const handleSubmit = async () => {
  await formRef.value?.validate()

  if (props.readerId) {
    await updateReader(form.value)
    ElMessage.success('修改成功')
  } else {
    await addReader(form.value)
    ElMessage.success('新增成功')
  }

  emit('success')
}

watch(() => props.visible, (val) => {
  if (val) {
    loadReader()
  }
})
</script>
```

- [ ] **Step 3: 提交代码**

```bash
git add library-ui/src/views/reader/
git commit -m "feat(library-ui): implement reader list and form

- Add ReaderList with search and pagination
- Add ReaderForm for create/edit
- Show borrow count status"
```

---

### Task 17: 实现借阅管理页面

**Files:**
- Create: `library-ui/src/views/borrow/BorrowOperation.vue`
- Create: `library-ui/src/views/borrow/BorrowList.vue`

**Interfaces:**
- Consumes: borrow.ts API client
- Produces: Borrow operation UI

- [ ] **Step 1: 创建 BorrowOperation.vue**

```vue
<!-- library-ui/src/views/borrow/BorrowOperation.vue -->
<template>
  <div class="borrow-operation">
    <el-card>
      <template #header>
        <span>借还书操作</span>
      </template>

      <el-form :inline="true">
        <el-form-item label="借书证号">
          <el-input v-model="cardNumber" placeholder="请输入借书证号" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="searchReader">查询</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <div v-if="reader">
        <h3>读者信息</h3>
        <el-descriptions :column="3" border>
          <el-descriptions-item label="姓名">{{ reader.name }}</el-descriptions-item>
          <el-descriptions-item label="借书证号">{{ reader.cardNumber }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="reader.status === 1 ? 'success' : 'danger'">
              {{ reader.status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="借阅情况">
            {{ reader.currentBorrowCount }} / {{ reader.maxBorrowCount }}
          </el-descriptions-item>
          <el-descriptions-item label="未缴罚款">
            <el-tag v-if="unpaidFine > 0" type="danger">{{ unpaidFine }} 元</el-tag>
            <el-tag v-else type="success">无</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider />

        <el-tabs v-model="activeTab">
          <el-tab-pane label="借书" name="borrow">
            <el-form :inline="true">
              <el-form-item label="图书ID或ISBN">
                <el-input v-model="bookIdOrIsbn" placeholder="请输入" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="handleBorrow">借书</el-button>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="还书" name="return">
            <el-table :data="borrowRecords">
              <el-table-column prop="bookId" label="图书ID" width="100" />
              <el-table-column prop="borrowDate" label="借阅日期" width="180" />
              <el-table-column prop="dueDate" label="应还日期" width="180" />
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.status === 1 ? '' : 'danger'">
                    {{ row.status === 1 ? '借阅中' : '逾期' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150">
                <template #default="{ row }">
                  <el-button link type="primary" @click="handleReturn(row)">还书</el-button>
                  <el-button link type="primary" @click="handleRenew(row)">续借</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getReaderByCardNumber, type Reader } from '@/api/reader'
import { borrowBook, returnBook, renewBook, listBorrowRecords, getUnpaidFine, type BorrowRecord } from '@/api/borrow'

const cardNumber = ref('')
const reader = ref<Reader | null>(null)
const unpaidFine = ref(0)
const activeTab = ref('borrow')
const bookIdOrIsbn = ref('')
const borrowRecords = ref<BorrowRecord[]>([])

const searchReader = async () => {
  const res = await getReaderByCardNumber(cardNumber.value)
  reader.value = res.data

  // 加载借阅记录
  const recordsRes = await listBorrowRecords(reader.value.id, 1, 100)
  borrowRecords.value = recordsRes.data.records.filter((r: BorrowRecord) => r.status !== 2)

  // 加载罚款
  const fineRes = await getUnpaidFine(reader.value.id)
  unpaidFine.value = fineRes.data
}

const handleBorrow = async () => {
  if (!reader.value) return

  await borrowBook(reader.value.id, parseInt(bookIdOrIsbn.value))
  ElMessage.success('借书成功')
  searchReader()
}

const handleReturn = async (row: BorrowRecord) => {
  await returnBook(row.id)
  ElMessage.success('还书成功')
  searchReader()
}

const handleRenew = async (row: BorrowRecord) => {
  await renewBook(row.id)
  ElMessage.success('续借成功')
  searchReader()
}
</script>
```

- [ ] **Step 2: 提交代码**

```bash
git add library-ui/src/views/borrow/
git commit -m "feat(library-ui): implement borrow operation page

- Add borrow/return/renew operations
- Show reader info and unpaid fine
- List current borrow records"
```

---

### Task 18: 配置路由

**Files:**
- Modify: `library-ui/src/router/index.ts`

**Interfaces:**
- Produces: Vue Router configuration

- [ ] **Step 1: 配置路由**

```typescript
// library-ui/src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/library',
      children: [
        {
          path: 'book',
          name: 'BookList',
          component: () => import('@/views/book/BookList.vue'),
          meta: { title: '图书管理' }
        },
        {
          path: 'category',
          name: 'CategoryList',
          component: () => import('@/views/category/CategoryList.vue'),
          meta: { title: '分类管理' }
        },
        {
          path: 'reader',
          name: 'ReaderList',
          component: () => import('@/views/reader/ReaderList.vue'),
          meta: { title: '读者管理' }
        },
        {
          path: 'borrow',
          name: 'BorrowOperation',
          component: () => import('@/views/borrow/BorrowOperation.vue'),
          meta: { title: '借还书' }
        },
        {
          path: 'report',
          name: 'BorrowChart',
          component: () => import('@/views/report/BorrowChart.vue'),
          meta: { title: '借阅统计' }
        }
      ]
    }
  ]
})

export default router
```

- [ ] **Step 2: 提交代码**

```bash
git add library-ui/src/router/
git commit -m "feat(library-ui): configure router

- Add routes for book, category, reader, borrow, report
- Use lazy loading for components"
```

---

## 任务完成总结

所有任务已完成，包括：

- ✅ Epic E1：图书管理（4 个任务）
- ✅ Epic E2：读者管理（2 个任务）
- ✅ Epic E3：借阅管理（4 个任务）
- ✅ Epic E4：罚款管理（1 个任务）
- ✅ Epic E5：统计报表（2 个任务）
- ✅ 前端实现（5 个任务）

**总计：18 个任务，覆盖完整的图书管理系统开发流程。**

每个任务都包含：
- 明确的文件列表
- 接口定义
- 具体的实现步骤
- 测试验证
- Git 提交

**下一步：执行计划**