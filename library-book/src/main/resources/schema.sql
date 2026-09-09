-- library-book/src/main/resources/schema.sql

-- 图书分类表
CREATE TABLE library_category (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    parent_id BIGINT,
    sort INT DEFAULT 0,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 添加表注释
COMMENT ON TABLE library_category IS '图书分类表';
COMMENT ON COLUMN library_category.id IS '主键ID';
COMMENT ON COLUMN library_category.name IS '分类名称';
COMMENT ON COLUMN library_category.parent_id IS '父分类ID';
COMMENT ON COLUMN library_category.sort IS '排序';
COMMENT ON COLUMN library_category.create_time IS '创建时间';
COMMENT ON COLUMN library_category.update_time IS '更新时间';

CREATE INDEX idx_parent_id ON library_category(parent_id);

-- 图书表
CREATE TABLE library_book (
    id BIGSERIAL PRIMARY KEY,
    isbn VARCHAR(20) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    author VARCHAR(100),
    publisher VARCHAR(100),
    category_id BIGINT,
    publish_date DATE,
    price DECIMAL(10,2),
    stock INT DEFAULT 0,
    available_stock INT DEFAULT 0,
    location VARCHAR(50),
    description TEXT,
    cover_image VARCHAR(255),
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 添加表注释
COMMENT ON TABLE library_book IS '图书表';
COMMENT ON COLUMN library_book.id IS '主键ID';
COMMENT ON COLUMN library_book.isbn IS 'ISBN号';
COMMENT ON COLUMN library_book.title IS '书名';
COMMENT ON COLUMN library_book.author IS '作者';
COMMENT ON COLUMN library_book.publisher IS '出版社';
COMMENT ON COLUMN library_book.category_id IS '分类ID';
COMMENT ON COLUMN library_book.publish_date IS '出版日期';
COMMENT ON COLUMN library_book.price IS '价格';
COMMENT ON COLUMN library_book.stock IS '总库存';
COMMENT ON COLUMN library_book.available_stock IS '可借库存';
COMMENT ON COLUMN library_book.location IS '馆藏位置';
COMMENT ON COLUMN library_book.description IS '简介';
COMMENT ON COLUMN library_book.cover_image IS '封面图片URL';
COMMENT ON COLUMN library_book.create_time IS '创建时间';
COMMENT ON COLUMN library_book.update_time IS '更新时间';

CREATE UNIQUE INDEX uk_isbn ON library_book(isbn);
CREATE INDEX idx_category_id ON library_book(category_id);
CREATE INDEX idx_title_author ON library_book(title, author);